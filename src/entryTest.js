// Entry-pillar test (research log 4 Nov 2026, roadmap "Entry-pillar test").
// Does buying a stock well off its 52-week high, or with weak 12-1 month
// momentum, lead to better or worse returns over the next 6 and 12 months?
// Pure functions; tools/entry-test.mjs fetches the prices and prints the result.
//
// Method: sample each stock at every month-end with a year of history behind
// it and 6 or 12 months ahead. Returns are measured as EXCESS over the average
// of all sampled stocks on the same date, so a rising or falling market drops
// out and only the ranking within the month counts.
import { median } from "./util.js";

export const OFF_HIGH_BUCKETS = [
  { key: "0-3", label: "0 to 3% off", min: -3, max: 0.0001 },
  { key: "3-10", label: "3 to 10% off", min: -10, max: -3 },
  { key: "10-20", label: "10 to 20% off", min: -20, max: -10 },
  { key: "20-30", label: "20 to 30% off", min: -30, max: -20 },
  { key: "30-45", label: "30 to 45% off", min: -45, max: -30 },
  { key: "45+", label: "over 45% off", min: -Infinity, max: -45 },
];
export const bucketOf = (offHigh) => OFF_HIGH_BUCKETS.find((b) => offHigh >= b.min && offHigh < b.max)?.key ?? null;

// rows: daily bars [{ date, high, close }] oldest first -> month-end samples.
export function samples(rows, symbol = null) {
  const out = [];
  if (!rows || rows.length < 253) return out;
  for (let d = 252; d < rows.length; d++) {
    const monthEnd = d === rows.length - 1 || rows[d + 1].date.slice(0, 7) !== rows[d].date.slice(0, 7);
    if (!monthEnd || d === rows.length - 1) continue;
    const c = rows[d].close;
    let hi = -Infinity;
    for (let k = d - 251; k <= d; k++) hi = Math.max(hi, rows[k].high ?? rows[k].close);
    const at = (k) => (k < rows.length ? rows[k].close : null);
    const f6 = at(d + 126), f12 = at(d + 252);
    out.push({
      symbol, date: rows[d].date,
      offHigh: (c / hi - 1) * 100,
      mom: (rows[d - 21].close / rows[d - 252].close - 1) * 100, // 12-1 month momentum
      fwd6: f6 == null ? null : (f6 / c - 1) * 100,
      fwd12: f12 == null ? null : (f12 / c - 1) * 100,
    });
  }
  return out;
}

// Excess returns over the same-date average, and momentum quintile (1 = weakest) per date.
export function relativise(all, minPerDate = 30) {
  const byDate = Object.groupBy(all, (s) => s.date);
  const out = [];
  for (const group of Object.values(byDate)) {
    if (group.length < minPerDate) continue;
    const avg = (k) => { const xs = group.map((s) => s[k]).filter((x) => x != null); return xs.length >= minPerDate ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const a6 = avg("fwd6"), a12 = avg("fwd12");
    const ranked = [...group].sort((x, y) => x.mom - y.mom);
    ranked.forEach((s, i) => out.push({ ...s, q: Math.min(5, Math.floor((i / ranked.length) * 5) + 1),
      ex6: s.fwd6 != null && a6 != null ? s.fwd6 - a6 : null, ex12: s.fwd12 != null && a12 != null ? s.fwd12 - a12 : null }));
  }
  return out;
}

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
function stats(xs, key) {
  const v = xs.map((s) => s[key]).filter((x) => x != null);
  if (!v.length) return { n: 0 };
  return { n: v.length, mean: r1(v.reduce((a, b) => a + b, 0) / v.length), median: r1(median(v)), beat: Math.round((v.filter((x) => x > 0).length / v.length) * 100) };
}
// Share of calendar years in which the group's mean excess was positive.
function yearsAhead(xs, key) {
  const by = Object.groupBy(xs.filter((s) => s[key] != null), (s) => s.date.slice(0, 4));
  const ys = Object.values(by).filter((g) => g.length >= 20).map((g) => g.reduce((a, s) => a + s[key], 0) / g.length);
  return ys.length ? `${ys.filter((m) => m > 0).length} of ${ys.length}` : null;
}

export function analyse(rel) {
  const group = (xs) => ({ ex6: stats(xs, "ex6"), ex12: stats(xs, "ex12"), years12: yearsAhead(xs, "ex12") });
  const byHigh = OFF_HIGH_BUCKETS.map((b) => ({ key: b.key, label: b.label, ...group(rel.filter((s) => bucketOf(s.offHigh) === b.key)) }));
  const byMom = [1, 2, 3, 4, 5].map((q) => ({ q, label: q === 1 ? "weakest fifth" : q === 5 ? "strongest fifth" : `fifth ${q}`, ...group(rel.filter((s) => s.q === q)) }));
  // The cell the current Entry pillar likes most (20 to 45% off) split by momentum.
  const deep = rel.filter((s) => s.offHigh < -20 && s.offHigh >= -45);
  const deepByMom = { weak: group(deep.filter((s) => s.q <= 2)), strong: group(deep.filter((s) => s.q >= 4)) };
  const dates = rel.map((s) => s.date).sort();
  return { samples: rel.length, stocks: new Set(rel.map((s) => s.symbol)).size, from: dates[0], to: dates.at(-1), byHigh, byMom, deepByMom };
}
