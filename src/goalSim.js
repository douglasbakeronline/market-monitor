// Goal odds for the Dashboard's private pots panel (runs in the browser; the
// pot values never leave it). A block bootstrap: each simulated path strings
// together random 12-month stretches of real monthly returns (S&P 500 total
// return since 1988, data/returns.json), so crashes, recoveries and runs of
// good years keep their real shape instead of being smoothed into an average.
// Display only: a range of what history allows, not a forecast.

// Last close of each calendar month from daily rows [{date, close}].
export function monthEnds(rows = []) {
  const by = new Map();
  for (const r of rows) if (r?.date && Number.isFinite(r.close)) by.set(r.date.slice(0, 7), r.close);
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, close]) => ({ m, close }));
}
export function monthlyReturns(ends = []) {
  const out = [];
  for (let i = 1; i < ends.length; i++) out.push({ m: ends[i].m, r: ends[i].close / ends[i - 1].close - 1 });
  return out;
}

// Small seeded PRNG (mulberry32) so the same inputs give the same picture.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const pctile = (sorted, p) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

// returns: monthly returns (decimals). haircut: points a year taken off every
// month's return (a cautious case: the world has trailed the US since 1988).
// cashShare of the pot sits in cash at cashRate a year (the dip reserve); it
// drifts towards cashLong by a sixth a month, as the reserve drip does.
export function simulateGoal({ returns, start = 0, monthly = 0, goal = null, years = 30, paths = 2000, block = 12, cashShare = 0.05, cashLong = null, cashRate = 0.03, haircut = 0, seed = 1 } = {}) {
  const n = returns?.length ?? 0;
  if (n < block * 2 || !(start >= 0) || !(years > 0)) return null;
  const rand = rng(seed);
  const months = Math.round(years * 12);
  const hf = Math.pow(1 - haircut / 100, 1 / 12), cm = Math.pow(1 + cashRate, 1 / 12) - 1;
  const long = cashLong ?? cashShare;
  const cashAt = Float64Array.from({ length: months + 1 }, (_, m) => long + (cashShare - long) * Math.pow(5 / 6, m));
  const atYear = Array.from({ length: years + 1 }, () => new Float64Array(paths));
  const hitMonth = new Float64Array(paths).fill(Infinity);
  for (let p = 0; p < paths; p++) {
    let v = start, i = 0, pos = block;
    atYear[0][p] = v;
    if (goal && v >= goal) hitMonth[p] = 0;
    for (let m = 1; m <= months; m++) {
      if (pos >= block) { i = Math.floor(rand() * (n - block + 1)); pos = 0; }
      const r = (1 + returns[i + pos]) * hf - 1;
      pos++;
      const c = cashAt[m];
      v = v * (1 + (1 - c) * r + c * cm) + monthly;
      if (goal && hitMonth[p] === Infinity && v >= goal) hitMonth[p] = m;
      if (m % 12 === 0) atYear[m / 12][p] = v;
    }
  }
  const bands = atYear.map((arr, y) => {
    const s = Array.from(arr).sort((a, b) => a - b);
    return { year: y, p10: pctile(s, 0.1), p25: pctile(s, 0.25), p50: pctile(s, 0.5), p75: pctile(s, 0.75), p90: pctile(s, 0.9) };
  });
  let hitBy = null, medianYears = null, slowYears = null;
  if (goal) {
    const hm = Array.from(hitMonth).sort((a, b) => a - b);
    hitBy = bands.map((b) => hm.filter((x) => x <= b.year * 12).length / paths);
    const med = pctile(hm.map((x) => (x === Infinity ? 1e9 : x)), 0.5), slow = pctile(hm.map((x) => (x === Infinity ? 1e9 : x)), 0.9);
    medianYears = med >= 1e9 ? null : med / 12;
    slowYears = slow >= 1e9 ? null : slow / 12;
  }
  const paid = start + monthly * months;
  return { years, paths, bands, hitBy, medianYears, slowYears, paid };
}

// Compound annual growth of a monthly series, for the page's footnote.
export const cagr = (r = []) => (r.length ? Math.pow(r.reduce((a, x) => a * (1 + x), 1), 12 / r.length) - 1 : null);

// Real history check (no resampling): start the same plan in every month of the
// record that has `years` of returns after it, and count how often it reached
// the goal within that time. Same cash and haircut handling as simulateGoal.
export function historyCheck({ returns, start = 0, monthly = 0, goal, years = 10, cashShare = 0.05, cashLong = null, cashRate = 0.03, haircut = 0 } = {}) {
  const months = Math.round(years * 12), n = returns?.length ?? 0;
  if (!goal || n < months + 1) return null;
  const hf = Math.pow(1 - haircut / 100, 1 / 12), cm = Math.pow(1 + cashRate, 1 / 12) - 1, long = cashLong ?? cashShare;
  let hit = 0, windows = 0;
  for (let s = 0; s + months <= n; s++) {
    let v = start, ok = v >= goal;
    for (let m = 1; m <= months && !ok; m++) {
      const c = long + (cashShare - long) * Math.pow(5 / 6, m);
      const r = (1 + returns[s + m - 1]) * hf - 1;
      v = v * (1 + (1 - c) * r + c * cm) + monthly;
      if (v >= goal) ok = true;
    }
    windows++; if (ok) hit++;
  }
  return { years, windows, hit, share: hit / windows };
}
