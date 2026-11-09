// Research: which index should the pullback rule watch? The rule brings a
// scheduled core purchase forward when an index is 5%+ below its 52-week high.
// Live it watches the S&P 500 or the FTSE 100; the fund bought is VWRP in
// pounds. This replays monthly core purchases of a global fund in pounds and,
// for each trigger source, counts how often a purchase came forward and what
// that saved or cost in the fund's own price compared with the scheduled date.
// Pure functions over daily rows [{date, close}] (oldest first).
import { drawdowns, stats } from "./dipStudy.js";

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Drawdown series keyed by date, skipping the warm-up year (no full 52 weeks).
export function ddByDate(rows, warm = 252) {
  const dd = drawdowns(rows);
  const out = [];
  for (let i = warm; i < rows.length; i++) out.push([rows[i].date, dd[i]]);
  return out; // [[date, dd]] oldest first
}

// The latest value strictly before `date` (what the morning playback knows
// before buying that day): avoids using a same-day US close that comes later.
export function priorLookup(series) {
  let j = 0, last = null;
  return (date) => {
    while (j < series.length && series[j][0] < date) { last = series[j][1]; j++; }
    return last;
  };
}

// Convert a USD series to pounds with GBPUSD=X (dollars per pound), same dates only.
export function toGbp(usdRows, fxRows) {
  const fx = new Map(fxRows.map((r) => [r.date, r.close]));
  return usdRows.filter((r) => fx.get(r.date) > 0).map((r) => ({ date: r.date, close: r.close / fx.get(r.date) }));
}

// First trading day of each month in the asset's calendar, from `from`.
export function monthStarts(rows, from) {
  const out = [];
  let prev = "";
  rows.forEach((r, i) => {
    const m = r.date.slice(0, 7);
    if (m !== prev) { if (r.date >= from) out.push(i); prev = m; }
  });
  return out;
}

// sources: { name: [[date, dd]] } ; asset: rows of the fund bought (pounds).
// Returns per source: months, how many came forward, days earlier, and the %
// saved by buying at the trigger instead of the scheduled date (positive = cheaper).
export function simulate(asset, sources, { from, threshold = -5, either = [] } = {}) {
  const sched = monthStarts(asset, from);
  const names = Object.keys(sources);
  const look = Object.fromEntries(names.map((n) => [n, priorLookup(sources[n])]));
  // Pre-read each source's value for every asset day (lookups are forward-only).
  const vals = asset.map((r) => Object.fromEntries(names.map((n) => [n, look[n](r.date)])));
  const combos = { ...Object.fromEntries(names.map((n) => [n, [n]])) };
  if (either.length) combos[either.join("|")] = either;
  const res = {};
  const firedBy = {}; // month index -> set of combos that fired
  for (const [label, parts] of Object.entries(combos)) {
    const months = [];
    for (let k = 1; k < sched.length; k++) {
      const a = sched[k - 1], s = sched[k];
      let hit = null;
      for (let i = a + 1; i < s; i++) {
        if (parts.some((p) => vals[i][p] != null && vals[i][p] <= threshold)) { hit = i; break; }
      }
      const gain = hit == null ? 0 : (asset[s].close / asset[hit].close - 1) * 100;
      months.push({ date: asset[s].date, hit: hit != null, early: hit == null ? 0 : s - hit, gain });
      if (hit != null) (firedBy[k] ??= new Set()).add(label);
    }
    const fired = months.filter((m) => m.hit);
    res[label] = {
      months: months.length,
      fired: fired.length,
      firedPct: months.length ? Math.round((fired.length / months.length) * 100) : null,
      medianDaysEarly: fired.length ? median(fired.map((m) => m.early)) : null,
      perPurchase: round1(months.reduce((x, m) => x + m.gain, 0) / (months.length || 1)), // mean % over all purchases
      whenFired: stats(fired.map((m) => m.gain)),
    };
  }
  return { from: asset[sched[0]]?.date ?? null, to: asset[asset.length - 1]?.date ?? null, threshold, sources: res, firedBy };
}

// How often two trigger sources agree, month by month.
export function agreement(firedBy, a, b, months) {
  let both = 0, onlyA = 0, onlyB = 0;
  for (let k = 1; k <= months; k++) {
    const s = firedBy[k];
    const x = !!s?.has(a), y = !!s?.has(b);
    if (x && y) both++; else if (x) onlyA++; else if (y) onlyB++;
  }
  return { both, [`only_${a}`]: onlyA, [`only_${b}`]: onlyB, neither: months - both - onlyA - onlyB };
}
