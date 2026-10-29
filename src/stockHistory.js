// Per-stock memory across research runs: daily scores (to show trends) and
// earnings dates (to measure how the stock reacted to its results).

const MAX_POINTS = 260;

// scores: { symbol: [[date, lt, sw], ...] } — one point per date, latest wins.
export function recordScores(scores, items, date) {
  const out = { ...(scores || {}) };
  for (const it of items) {
    const pts = (out[it.symbol] || []).filter((p) => p[0] !== date);
    pts.push([date, it.longTerm?.score ?? null, it.swing?.score ?? null]);
    out[it.symbol] = pts.sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-MAX_POINTS);
  }
  return out;
}

// Change in long-term score vs the most recent point at least `days` old.
export function scoreChange(points, today, days = 7) {
  if (!points?.length) return null;
  const cutoff = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
  const now = points[points.length - 1];
  const then = [...points].reverse().find((p) => p[0] <= cutoff);
  if (!then || now[1] == null || then[1] == null) return null;
  return { lt: now[1] - then[1], sw: now[2] != null && then[2] != null ? now[2] - then[2] : null, since: then[0] };
}

// earnings: { symbol: ["YYYY-MM-DD", ...] }
export function recordEarnings(earnings, symbol, date) {
  if (!date) return earnings;
  const out = { ...(earnings || {}) };
  const set = new Set(out[symbol] || []);
  set.add(date);
  out[symbol] = [...set].sort().slice(-12);
  return out;
}

// The move around the most recent results that have already happened:
// close before the results day to close after it, so it captures the reaction
// whether the company reported before the open or after the close.
export function lastReaction(dates, rows, today, maxAgeDays = 45) {
  const past = (dates || []).filter((d) => d < today || d === today).sort();
  const d = past[past.length - 1];
  if (!d || !rows?.length) return null;
  if (Date.parse(today) - Date.parse(d) > maxAgeDays * 86400000) return null;
  const before = [...rows].reverse().find((r) => r.date < d);
  const after = rows.find((r) => r.date > d);
  if (!before) return null;
  if (!after) return { date: d, pending: true };
  return { date: d, pending: false, pct: Math.round(((after.close - before.close) / before.close) * 1000) / 10, from: before.date, to: after.date };
}
