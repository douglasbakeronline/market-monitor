// Swing lab round 3 (10 Nov 2026): sector rotation by momentum.
// Rounds 1 and 2 tested single stocks, where the backtest cannot escape
// survivorship (only today's index members). Sector funds avoid that: the
// nine original Select Sector SPDR funds (XLB XLE XLF XLI XLK XLP XLU XLV XLY)
// have traded since December 1998 and none has closed. On Trading 212 the
// same exposures exist as UCITS sector ETFs; these US funds are only the
// long, clean price record.
//
// Pre-registered BEFORE the run (nothing tuned afterwards):
//   PRIMARY (Moskowitz and Grinblatt 1999, industry momentum; Faber 2010,
//   relative-strength sector rotation): at each month end hold the 3 sectors
//   with the best 3-month total return, equal weight, for one month.
//   It passes if, after costs (0.1% of each side traded), it beats holding all
//   nine equally (rebalanced monthly) by at least 1 point a year, its worst
//   fall is no more than 5 points deeper, it is ahead in at least 60% of
//   rolling 3-year windows, and it is ahead in both halves (1999-2012 and
//   2013 on).
//   SECONDARY (shown, no verdict): 1, 6 and 12-month lookbacks; 12-1 month
//   momentum; the primary with a trend filter (a sector below its 10-month
//   average is held as cash at 0%, as in Faber 2007).
import { r2 } from "./util.js";

export const SECTORS = ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY"];
export const ROT_BAR = { minExcess: 1, maxDdGap: 5, rollingShare: 0.6, window: 36 };
export const COST = 0.001;

// Month-end closes from bars [{date, close}] (adjusted closes for total return).
export function monthEndCloses(bars) {
  const m = new Map();
  for (const b of bars) if (b.close > 0) m.set(b.date.slice(0, 7), b.close);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, close]) => ({ month, close }));
}

// Align several series on months they all have. Returns { months, closes: {sym: [..]} }.
export function align(series) {
  const syms = Object.keys(series);
  const sets = syms.map((s) => new Map(series[s].map((x) => [x.month, x.close])));
  const months = [...sets[0].keys()].filter((m) => sets.every((st) => st.has(m))).sort();
  return { months, closes: Object.fromEntries(syms.map((s, i) => [s, months.map((m) => sets[i].get(m))])) };
}

// Monthly backtest. Signal at month end t (using closes up to t), held over
// month t+1. opts: lookback (months), skip (1 for 12-1), top, trend (10-month
// average filter), cost per side. Equal weight among held sectors; cash earns 0.
export function rotate({ months, closes }, { lookback = 3, skip = 0, top = 3, trend = false, cost = COST, start = null } = {}) {
  const syms = Object.keys(closes), n = months.length;
  const first = Math.max(lookback + skip, trend ? 9 : 0, start != null ? months.indexOf(start) : 0);
  const out = [];
  let prev = Object.fromEntries(syms.map((s) => [s, 0]));
  for (let t = first; t < n - 1; t++) {
    const score = syms.map((s) => ({ s, v: closes[s][t - skip] / closes[s][t - skip - lookback] - 1 })).sort((a, b) => b.v - a.v);
    const pick = top >= syms.length ? syms : score.slice(0, top).map((x) => x.s);
    const w = Object.fromEntries(syms.map((s) => [s, 0]));
    for (const s of pick) {
      let ok = true;
      if (trend) { let a = 0; for (let k = t - 9; k <= t; k++) a += closes[s][k]; ok = closes[s][t] >= a / 10; }
      if (ok) w[s] = 1 / pick.length;
    }
    const turnover = syms.reduce((a, s) => a + Math.abs(w[s] - prev[s]), 0);
    const gross = syms.reduce((a, s) => a + w[s] * (closes[s][t + 1] / closes[s][t] - 1), 0);
    out.push({ month: months[t + 1], r: gross - turnover * cost, turnover, held: pick.filter((s) => w[s] > 0) });
    // Weights drift with returns before the next rebalance.
    const tot = syms.reduce((a, s) => a + w[s] * (closes[s][t + 1] / closes[s][t]), 0) + (1 - syms.reduce((a, s) => a + w[s], 0));
    prev = Object.fromEntries(syms.map((s) => [s, tot > 0 ? (w[s] * (closes[s][t + 1] / closes[s][t])) / tot : 0]));
  }
  return out;
}

export function stats(rs) {
  if (!rs.length) return null;
  let v = 1, peak = 1, dd = 0;
  for (const x of rs) { v *= 1 + x.r; peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
  const yrs = rs.length / 12, mean = rs.reduce((a, x) => a + x.r, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, x) => a + (x.r - mean) ** 2, 0) / Math.max(1, rs.length - 1));
  return { months: rs.length, cagr: r2((Math.pow(v, 1 / yrs) - 1) * 100), vol: r2(sd * Math.sqrt(12) * 100), maxDd: r2(dd * 100),
    turnover: r2((rs.reduce((a, x) => a + (x.turnover ?? 0), 0) / yrs) * 100) };
}

// Strategy vs benchmark on the same months: excess CAGR, drawdown gap,
// rolling 3-year windows ahead, halves.
export function compare(strat, bench, { split = "2013-01", bar = ROT_BAR } = {}) {
  const bm = new Map(bench.map((x) => [x.month, x]));
  const s = strat.filter((x) => bm.has(x.month)), b = s.map((x) => bm.get(x.month));
  const S = stats(s), B = stats(b);
  const roll = [];
  for (let i = 0; i + bar.window <= s.length; i++) {
    const a = stats(s.slice(i, i + bar.window)), c = stats(b.slice(i, i + bar.window));
    roll.push(a.cagr - c.cagr);
  }
  const half = (f) => { const xs = s.filter((x) => f(x.month)), ys = xs.map((x) => bm.get(x.month)); const a = stats(xs), c = stats(ys); return a && c ? { from: xs[0].month, to: xs.at(-1).month, cagr: a.cagr, bench: c.cagr, excess: r2(a.cagr - c.cagr) } : null; };
  const halves = [half((m) => m < split), half((m) => m >= split)];
  const excess = r2(S.cagr - B.cagr), ddGap = r2(B.maxDd - S.maxDd), rollShare = roll.length ? r2(roll.filter((x) => x > 0).length / roll.length) : null;
  const checks = { excess: excess >= bar.minExcess, drawdown: ddGap <= bar.maxDdGap, rolling: rollShare != null && rollShare >= bar.rollingShare, halves: halves.every((h) => h && h.excess > 0) };
  return { strat: S, bench: B, excess, ddGap, rollShare, halves, monthsAhead: r2(s.filter((x, i) => x.r > b[i].r).length / s.length), checks, pass: Object.values(checks).every(Boolean) };
}

// Today's ranking (the latest complete month end).
export function latest({ months, closes }, { lookback = 3, top = 3 } = {}) {
  const t = months.length - 1;
  const rank = Object.keys(closes).map((s) => {
    let a = 0; for (let k = t - 9; k <= t; k++) a += closes[s][k];
    return { s, mom: r2((closes[s][t] / closes[s][t - lookback] - 1) * 100), aboveTrend: closes[s][t] >= a / 10 };
  }).sort((a, b) => b.mom - a.mom);
  return { month: months[t], top: rank.slice(0, top).map((x) => x.s), rank };
}
