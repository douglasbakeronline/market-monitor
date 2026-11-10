// Swing lab (Douglas, 10 Nov 2026: develop the swing intelligence).
// Our own swing setup showed no edge over random entry after costs (research
// log 1 and 5 Nov). Instead of tuning it further, this tests a few short-term
// effects that are documented in published research, each written down here
// BEFORE the backtest ran (pre-registered), against random entry with the
// same exits, after Trading 212 costs:
//   drift   Post-results drift on a volume shock: a +4% day on 3x normal
//           volume (in practice usually results), buy next open, hold 20
//           sessions. Bernard and Thomas (1989); Gervais, Kaniel and
//           Mingelgrin (2001, high-volume return premium).
//   dip     Short-term reversal inside a long-term uptrend: close above the
//           200-day average and 2-day RSI under 10, buy next open, sell at the
//           first close above the 5-day average or after 10 sessions.
//           Lehmann (1990), Jegadeesh (1990); Connors and Alvarez (2009).
//   high    52-week-high breakout: first close at a 252-day high in 20
//           sessions, buy next open, hold 20 sessions. George and Hwang (2004).
// Each also runs with the agreed swing stop (2x ATR below entry, checked on
// the daily low; a bar that gaps below it exits at the open).
// The pure functions here take daily bars ({date, open, high, low, close,
// volume}, oldest first) so they can be tested without the network.
import { sma, rsi, atr } from "./indicators.js";
import { r2 } from "./util.js";
import { COSTS } from "./swingRetune.js";

export const STRATEGIES = [
  { key: "drift", label: "Post-results drift (+4% day on 3x volume, hold 20 sessions)", exit: "hold20" },
  { key: "dip", label: "Dip in an uptrend (2-day RSI < 10 above the 200-day, exit above the 5-day)", exit: "ma5" },
  { key: "high", label: "52-week-high breakout (hold 20 sessions)", exit: "hold20" },
];

// The bar a strategy must clear, fixed before the run: after costs it beats
// random entry with the same exit by at least MIN_EDGE percentage points per
// trade, makes money itself, has MIN_TRADES trades, is ahead of random entry
// in at least three of every four years with 50+ trades, and the edge holds
// in both the US and the UK where each has 100+ trades.
export const LAB_BAR = { minEdge: 0.4, minTrades: 300, yearShare: 0.75, minYearTrades: 50 };

// Indicator arrays aligned to the bars.
export function prepare(rows) {
  const close = rows.map((r) => r.close), vol = rows.map((r) => r.volume || 0);
  const vAvg = new Array(rows.length).fill(null);
  let s = 0;
  for (let i = 0; i < rows.length; i++) {
    // Average volume of the 50 sessions BEFORE today, so today's spike does
    // not dilute its own baseline.
    if (i >= 51) { s += vol[i - 1] - vol[i - 51]; vAvg[i] = s / 50; } else if (i >= 1) { s += vol[i - 1]; if (i === 50) vAvg[i] = s / 50; }
  }
  const hi = new Array(rows.length).fill(null);
  for (let i = 251; i < rows.length; i++) { let m = -Infinity; for (let k = i - 251; k <= i; k++) m = Math.max(m, close[k]); hi[i] = m; }
  return { close, vol, vAvg, sma200: sma(close, 200), sma5: sma(close, 5), rsi2: rsi(close, 2), atr14: atr(rows, 14), hi };
}

// Does strategy `key` signal at the close of bar d?
export function signal(key, rows, ind, d) {
  const { close, vol, vAvg, sma200, rsi2, hi } = ind;
  if (d < 252 || d >= rows.length) return false;
  if (key === "drift") {
    const ret = close[d] / close[d - 1] - 1;
    return ret >= 0.04 && vAvg[d] > 0 && vol[d] >= 3 * vAvg[d];
  }
  if (key === "dip") return sma200[d] != null && close[d] > sma200[d] && rsi2[d] != null && rsi2[d] < 10;
  if (key === "high") {
    if (!(hi[d] != null && close[d] >= hi[d])) return false;
    for (let k = d - 20; k < d; k++) if (hi[k] != null && close[k] >= hi[k]) return false;
    return true;
  }
  return false;
}

// Simulate one trade signalled at the close of bar d: entry at the next open.
// exit "hold20": the close 20 sessions after entry; "ma5": the first close
// above the 5-day average, or the 10th session. stop: true adds the 2x ATR
// stop. Returns null if there is no next bar or the trade is still open.
export function simulate(rows, ind, d, exit, { stop = false } = {}) {
  const e = d + 1;
  if (e >= rows.length) return null;
  const entry = rows[e].open;
  if (!(entry > 0)) return null;
  const stopPx = stop && ind.atr14[d] > 0 ? entry - 2 * ind.atr14[d] : null;
  const max = exit === "ma5" ? 10 : 20;
  for (let k = e; k < rows.length; k++) {
    const held = k - e + 1;
    if (stopPx != null && rows[k].low <= stopPx) {
      const px = k > e && rows[k].open < stopPx ? rows[k].open : stopPx;
      return { entryIdx: e, exitIdx: k, entry, exit: px, stopped: true };
    }
    if (exit === "ma5" && ind.sma5[k] != null && rows[k].close > ind.sma5[k]) return { entryIdx: e, exitIdx: k, entry, exit: rows[k].close, stopped: false };
    if (held >= max) return { entryIdx: e, exitIdx: k, entry, exit: rows[k].close, stopped: false };
  }
  return null;
}

// Net return of a trade in percent after Trading 212 costs (US: FX fee both
// ways; UK: stamp duty on the purchase).
export const netPct = (t, market) => ((t.exit / t.entry - 1) - (COSTS[market] ?? 0)) * 100;

// Run every strategy (and its random baseline) over one stock. One open trade
// per strategy at a time. The baseline enters on a pseudo-random ~1 in 10 of
// the days it could, with the same exit; "cond" baselines for dip also
// require the uptrend, to test whether the dip itself adds anything.
export function runStock(rows, market, { index = null, seed = 1 } = {}) {
  const ind = prepare(rows);
  const out = [];
  let x = seed >>> 0;
  const rand = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const idxRet = (t) => {
    if (!index) return null;
    const a = index.get(rows[t.entryIdx - 1].date), b = index.get(rows[t.exitIdx].date);
    return a && b ? (b / a - 1) * 100 : null;
  };
  const push = (strategy, kind, stop, d, t) => out.push({ strategy, kind, stop, market, date: rows[d].date, year: rows[t.entryIdx].date.slice(0, 4), days: t.exitIdx - t.entryIdx + 1, net: netPct(t, market), idx: idxRet(t), stopped: t.stopped });
  for (const s of STRATEGIES) {
    for (const stop of [false, true]) {
      const free = { sig: 252, rnd: 252, cond: 252 };
      for (let d = 252; d < rows.length - 1; d++) {
        if (d >= free.sig && signal(s.key, rows, ind, d)) {
          const t = simulate(rows, ind, d, s.exit, { stop });
          if (t) { push(s.key, "signal", stop, d, t); free.sig = t.exitIdx + 1; }
        }
        if (d >= free.rnd && rand() < 0.1) {
          const t = simulate(rows, ind, d, s.exit, { stop });
          if (t) { push(s.key, "random", stop, d, t); free.rnd = t.exitIdx + 1; }
        }
        if (s.key === "dip" && d >= free.cond && ind.sma200[d] != null && rows[d].close > ind.sma200[d] && rand() < 0.1) {
          const t = simulate(rows, ind, d, s.exit, { stop });
          if (t) { push(s.key, "cond", stop, d, t); free.cond = t.exitIdx + 1; }
        }
      }
    }
  }
  return out;
}

function stat(xs) {
  if (!xs.length) return { n: 0, avg: null, win: null, vsIdx: null, days: null, t: null };
  const n = xs.length, avg = xs.reduce((a, t) => a + t.net, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, t) => a + (t.net - avg) ** 2, 0) / Math.max(1, n - 1));
  const ix = xs.filter((t) => t.idx != null);
  return {
    n, avg: r2(avg), win: Math.round((xs.filter((t) => t.net > 0).length / n) * 100),
    vsIdx: ix.length ? r2(ix.reduce((a, t) => a + t.net - t.idx, 0) / ix.length) : null,
    days: r2(xs.reduce((a, t) => a + t.days, 0) / n), sd: r2(sd), t: sd > 0 ? r2(avg / (sd / Math.sqrt(n))) : null,
  };
}

// Welch t-statistic for the difference of two means (trades overlap in time,
// so treat it as optimistic).
function welch(a, b) {
  const m = (xs) => xs.reduce((s, t) => s + t.net, 0) / xs.length;
  const v = (xs, mu) => xs.reduce((s, t) => s + (t.net - mu) ** 2, 0) / Math.max(1, xs.length - 1);
  if (a.length < 2 || b.length < 2) return null;
  const ma = m(a), mb = m(b);
  const se = Math.sqrt(v(a, ma) / a.length + v(b, mb) / b.length);
  return se > 0 ? r2((ma - mb) / se) : null;
}

// Summarise all trades: per strategy and stop setting, signal vs random (and
// the conditional baseline for dip), by year and by market, with the verdict
// against LAB_BAR.
export function analyseLab(trades, bar = LAB_BAR) {
  const years = [...new Set(trades.map((t) => t.year))].sort();
  const res = [];
  for (const s of STRATEGIES) {
    for (const stop of [false, true]) {
      const pick = (kind, f = () => true) => trades.filter((t) => t.strategy === s.key && t.stop === stop && t.kind === kind && f(t));
      const sig = pick("signal"), base = pick(s.key === "dip" ? "cond" : "random"), anyDay = pick("random");
      const S = stat(sig), B = stat(base), A = stat(anyDay);
      const edge = S.avg != null && B.avg != null ? r2(S.avg - B.avg) : null;
      const byYear = years.map((y) => {
        const a = stat(sig.filter((t) => t.year === y)), b = stat(base.filter((t) => t.year === y));
        return { year: y, n: a.n, avg: a.avg, base: b.avg, edge: a.avg != null && b.avg != null ? r2(a.avg - b.avg) : null };
      });
      const byMarket = ["US", "UK"].map((mk) => {
        const a = stat(sig.filter((t) => t.market === mk)), b = stat(base.filter((t) => t.market === mk));
        return { market: mk, n: a.n, avg: a.avg, base: b.avg, edge: a.avg != null && b.avg != null ? r2(a.avg - b.avg) : null };
      });
      const counted = byYear.filter((y) => y.n >= bar.minYearTrades && y.edge != null);
      const ahead = counted.filter((y) => y.edge > 0).length;
      const mkts = byMarket.filter((m) => m.n >= 100 && m.edge != null);
      const checks = {
        edge: edge != null && edge >= bar.minEdge,
        positive: S.avg != null && S.avg > 0,
        sample: S.n >= bar.minTrades,
        years: counted.length > 0 && ahead / counted.length >= bar.yearShare,
        markets: mkts.length > 0 && mkts.every((m) => m.edge > 0),
      };
      res.push({ key: s.key, label: s.label, stop, signal: S, baseline: { ...B, kind: s.key === "dip" ? "random day in an uptrend" : "random day" }, anyDay: A,
        edge, tEdge: welch(sig, base), byYear, byMarket, yearsAhead: ahead, yearsCounted: counted.length, checks, clear: Object.values(checks).every(Boolean) });
    }
  }
  return res;
}
