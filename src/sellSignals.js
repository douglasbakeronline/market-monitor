// Sell and risk signals for a stock you hold (display only). Each is an event
// on the day it first happens, not a state: the close breaks below the 200-day
// after a month above it, the 50-day crosses under the 200-day, RSI first
// reaches 75, a one-day fall of 8% or more, or the close drops below a
// trailing stop (highest close of 60 sessions minus 3 ATR). Whether any of
// them has told holders anything useful is tested in tools/sell-study.mjs
// against each stock's home index; the page shows that verdict beside the signal.
import { sma, rsi, atr } from "./indicators.js";

export const SELL_KINDS = {
  trendBreak: { label: "Broke below its 200-day", why: "First close below the 200-day average after at least a month above it." },
  deathCross: { label: "Death cross", why: "The 50-day average crossed below the 200-day." },
  overbought: { label: "Overbought (RSI 75+)", why: "The 14-day RSI reached 75, a stretched price." },
  bigFall: { label: "Fell 8%+ in a day", why: "A one-day fall of 8% or more, often results or news." },
  trailStop: { label: "Hit a trailing stop", why: "Closed below the highest close of the last 60 sessions minus 3 times the average daily range (ATR)." },
};

export function prepare(rows) {
  const c = rows.map((r) => r.close);
  return { c, s50: sma(c, 50), s200: sma(c, 200), r14: rsi(c, 14), atr: atr(rows, 14) };
}

const stopAt = (p, i) => {
  if (i < 60 || p.atr[i] == null) return null;
  let hi = -Infinity; for (let k = i - 59; k <= i; k++) hi = Math.max(hi, p.c[k]);
  return hi - 3 * p.atr[i];
};

// Kinds firing at bar i (needs ~220 bars of history for the 200-day ones).
export function sellSignalsAt(p, i) {
  const out = [];
  const { c, s50, s200, r14 } = p;
  if (i < 1) return out;
  if (s200[i] != null && c[i] < s200[i] && i >= 221) {
    let above = true; for (let k = i - 20; k < i; k++) if (s200[k] == null || c[k] < s200[k]) { above = false; break; }
    if (above) out.push("trendBreak");
  }
  if (s50[i] != null && s200[i] != null && s50[i - 1] != null && s200[i - 1] != null && s50[i] < s200[i] && s50[i - 1] >= s200[i - 1]) out.push("deathCross");
  if (r14[i] != null && r14[i - 1] != null && r14[i] >= 75 && r14[i - 1] < 75) out.push("overbought");
  if (c[i - 1] > 0 && c[i] / c[i - 1] - 1 <= -0.08) out.push("bigFall");
  const st = stopAt(p, i), stPrev = stopAt(p, i - 1);
  if (st != null && stPrev != null && c[i] < st && c[i - 1] >= stPrev) out.push("trailStop");
  return out;
}

// Live use: the signals on the latest bar, with labels and the trailing stop level.
export function latestSellSignals(rows) {
  if (!rows || rows.length < 61) return { signals: [], stop: null };
  const p = prepare(rows), i = rows.length - 1;
  const st = stopAt(p, i);
  return { signals: sellSignalsAt(p, i).map((k) => ({ kind: k, ...SELL_KINDS[k] })), stop: st == null ? null : Math.round(st * 100) / 100 };
}

// Backtest summary of forward excess returns (stock minus home index, %) per
// kind and horizon, against the same universe's average day (survivorship bias
// in today's index members lifts both alike). A sell signal "works" when what
// followed was clearly worse than an average day by more than the cost of
// selling and buying back.
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : null; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
export const ROUND_TRIP = 0.4; // %: spread and FX (US) or stamp duty on the rebuy (UK), roughly
export function summariseSell(events, baseline, horizons = ["d5", "d21", "d63"]) {
  const base = Object.fromEntries(horizons.map((h) => [h, mean(baseline.map((b) => b[h]).filter((x) => x != null))]));
  const byKind = {};
  for (const k of Object.keys(SELL_KINDS)) {
    const ev = events.filter((e) => e.kind === k);
    const res = { n: ev.length };
    for (const h of horizons) {
      const xs = ev.map((e) => e[h]).filter((x) => x != null);
      const m = mean(xs), s = sd(xs);
      res[h] = { n: xs.length, excess: r2(m), vsAverage: m == null || base[h] == null ? null : r2(m - base[h]),
        worse: xs.length ? Math.round((xs.filter((x) => x < (base[h] ?? 0)).length / xs.length) * 100) : null,
        t: m == null || !s ? null : r2(((m - (base[h] ?? 0)) / s) * Math.sqrt(xs.length)) };
    }
    const d = res.d21;
    res.verdict = d.n < 100 ? "too few" : d.vsAverage <= -ROUND_TRIP && d.t <= -2 ? "useful" : d.vsAverage >= ROUND_TRIP && d.t >= 2 ? "opposite" : "no edge";
    byKind[k] = res;
  }
  return { base: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, r2(v)])), byKind };
}
