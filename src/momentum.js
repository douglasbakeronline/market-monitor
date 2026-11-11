// Swing lab round 5 (11 Nov 2026): stock momentum held for weeks to months.
// Douglas asked to develop the swing side. Rounds 1 to 4 found no short-term
// edge after Trading 212 costs. Momentum is the best-documented anomaly in the
// research (Jegadeesh and Titman 1993; Asness, Moskowitz and Pedersen 2013),
// and holding for a month at a time trades far less than a 20-session swing.
//
// Pre-registered BEFORE the run (nothing tuned afterwards):
//   PRIMARY: separately for the S&P 500 and the FTSE 100, at each month end
//   rank today's members that have 12 months of prices by their return from
//   12 months ago to 1 month ago (12-1 momentum); hold the top 10, equal
//   weight, for the next month. If the home index (price) closed below its
//   10-month average at that month end, hold cash (0%) instead (Faber 2007;
//   momentum crashes cluster after bear markets, Daniel and Moskowitz 2016).
//   Costs: Trading 212 round trip, US 0.3% (FX fee both ways), UK 0.5% (stamp
//   duty), charged on every pound bought or sold (half each side).
//   Benchmark: every member with a price, equal weight, rebalanced monthly,
//   no costs (the same survivorship as the strategy).
//   It passes only if, in BOTH markets: it beats the benchmark by 2+ points a
//   year (a higher bar than round 3's 1 point, because testing today's
//   members flatters past winners most), its worst fall is no more than 5
//   points deeper, it is ahead in 60%+ of rolling 3-year spells, and ahead in
//   both halves (split January 2016).
//   SECONDARY (shown, no verdict): no trend filter; top 20; 6-1 momentum.
//   REALITY CHECK (no survivorship): iShares MSCI USA Momentum (MTUM) against
//   SPY since its first full month, total return. A real momentum fund that
//   has not beaten the market would mean the backtest's edge is mostly bias.
import { r2 } from "./util.js";
import { stats, compare } from "./sectorRotation.js";

export const MOM_BAR = { minExcess: 2, maxDdGap: 5, rollingShare: 0.6, window: 36 };
export const MOM_SPLIT = "2016-01";
export const MOM_COST = { US: 0.003, UK: 0.005 };

// Put several month-end series on one month list; missing months are null.
// series: { sym: [{month, close}] }, months: sorted master list.
export function onMonths(series, months) {
  const out = {};
  for (const [s, xs] of Object.entries(series)) {
    const m = new Map(xs.map((x) => [x.month, x.close]));
    out[s] = months.map((mo) => (m.has(mo) ? m.get(mo) : null));
  }
  return out;
}

// Monthly backtest. closes: {sym: [close|null]} on `months`; index: [close]
// on the same months (for the trend filter). Signal at month end t, held over
// t+1. opts: lookback and skip (12-1 = 11 and 1), top, trend, cost (round
// trip; half charged per side on turnover), start (first month to hold).
export function momentum(months, closes, index, { lookback = 11, skip = 1, top = 10, trend = true, cost = MOM_COST.US, start = null } = {}) {
  const syms = Object.keys(closes), n = months.length;
  const first = Math.max(lookback + skip, 9, start != null ? Math.max(0, months.indexOf(start) - 1) : 0);
  const ok = (s, k) => k >= 0 && closes[s][k] != null && closes[s][k] > 0;
  const out = [];
  let prev = {};
  for (let t = first; t < n - 1; t++) {
    const elig = syms.filter((s) => ok(s, t) && ok(s, t - skip) && ok(s, t - skip - lookback));
    if (!elig.length) continue;
    const ranked = elig.map((s) => ({ s, v: closes[s][t - skip] / closes[s][t - skip - lookback] - 1 })).sort((a, b) => b.v - a.v || (a.s < b.s ? -1 : 1));
    const pick = top >= elig.length ? elig : ranked.slice(0, top).map((x) => x.s);
    let invest = true;
    if (trend && index) {
      let a = 0, c = 0;
      for (let k = t - 9; k <= t; k++) if (index[k] != null) { a += index[k]; c++; }
      invest = c === 10 && index[t] >= a / 10;
    }
    const w = {};
    if (invest) for (const s of pick) w[s] = 1 / pick.length;
    const keys = new Set([...Object.keys(w), ...Object.keys(prev)]);
    let turnover = 0;
    for (const s of keys) turnover += Math.abs((w[s] ?? 0) - (prev[s] ?? 0));
    let gross = 0;
    const g = (s) => (ok(s, t + 1) ? closes[s][t + 1] / closes[s][t] : 1); // a missing month counts as flat
    for (const s of Object.keys(w)) gross += w[s] * (g(s) - 1);
    out.push({ month: months[t + 1], r: gross - turnover * (cost / 2), turnover, held: invest ? pick : [], cash: !invest });
    const tot = Object.keys(w).reduce((a, s) => a + w[s] * g(s), 0) + (invest ? 0 : 1);
    prev = Object.fromEntries(Object.keys(w).map((s) => [s, tot > 0 ? (w[s] * g(s)) / tot : 0]));
  }
  return out;
}

// Equal weight of every member with a price both months (no costs).
export function equalWeight(months, closes, { start = null } = {}) {
  const syms = Object.keys(closes), out = [];
  const t0 = start != null ? Math.max(0, months.indexOf(start) - 1) : 0;
  for (let t = t0; t < months.length - 1; t++) {
    const xs = syms.filter((s) => closes[s][t] > 0 && closes[s][t + 1] > 0);
    if (!xs.length) continue;
    out.push({ month: months[t + 1], r: xs.reduce((a, s) => a + closes[s][t + 1] / closes[s][t] - 1, 0) / xs.length, turnover: 0 });
  }
  return out;
}

// Monthly returns of a single total-return series.
export function monthly(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i++) out.push({ month: xs[i].month, r: xs[i].close / xs[i - 1].close - 1, turnover: 0 });
  return out;
}

// One market: primary and secondaries against the benchmark.
export function studyMarket(months, closes, index, market, { start = null, split = MOM_SPLIT } = {}) {
  const cost = MOM_COST[market];
  const bench = equalWeight(months, closes, { start });
  const variants = [
    ["primary", "Top 10 by 12-1 month return, trend filter (primary)", { top: 10, trend: true }],
    ["noTrend", "Top 10, no trend filter", { top: 10, trend: false }],
    ["top20", "Top 20, trend filter", { top: 20, trend: true }],
    ["m6", "Top 10 by 6-1 month return, trend filter", { lookback: 5, skip: 1, top: 10, trend: true }],
  ];
  const results = variants.map(([key, label, o]) => {
    const rs = momentum(months, closes, index, { cost, start, ...o });
    const c = compare(rs, bench, { split, bar: MOM_BAR });
    return { key, label, ...c, cashShare: rs.length ? r2(rs.filter((x) => x.cash).length / rs.length) : null };
  });
  const p = momentum(months, closes, index, { cost, start, top: 10, trend: true });
  return { market, members: Object.keys(closes).length, from: bench[0]?.month ?? null, to: bench.at(-1)?.month ?? null, bench: stats(bench), results,
    lastHeld: p.at(-1)?.held ?? [], lastCash: p.at(-1)?.cash ?? null };
}

// Verdict: primary must pass in both markets.
export function momVerdict(markets) {
  const prim = markets.map((m) => m.results.find((r) => r.key === "primary"));
  return { pass: prim.length > 0 && prim.every((r) => r?.pass), byMarket: Object.fromEntries(markets.map((m, i) => [m.market, !!prim[i]?.pass])) };
}

// Today's top names for a market (latest complete month end), display only.
export function momentumNow(months, closes, index, { top = 10 } = {}) {
  const t = months.length - 1;
  const elig = Object.keys(closes).filter((s) => closes[s][t] > 0 && closes[s][t - 1] > 0 && closes[s][t - 12] > 0);
  const ranked = elig.map((s) => ({ s, mom: r2((closes[s][t - 1] / closes[s][t - 12] - 1) * 100) })).sort((a, b) => b.mom - a.mom);
  let a = 0; for (let k = t - 9; k <= t; k++) a += index[k] ?? 0;
  return { month: months[t], top: ranked.slice(0, top), trendUp: index[t] >= a / 10 };
}

// Drop one-month spikes (pence/pounds mix-ups in UK data): a close 5x above
// or below BOTH neighbours is removed.
export function cleanSpikes(xs) {
  return xs.filter((x, i) => {
    const a = xs[i - 1]?.close, b = xs[i + 1]?.close;
    if (!a || !b) return true;
    const ra = x.close / a, rb = x.close / b;
    return !((ra > 5 && rb > 5) || (ra < 0.2 && rb < 0.2));
  });
}
