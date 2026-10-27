// Historical context: "the last times Fear & Greed was around today's level,
// what did the S&P 500 do next?" Uses CNN history (from mid-2020, growing over
// time as we store it) aligned with S&P 500 daily closes.
import { median, r1 } from "./util.js";

const HORIZONS = [
  { key: "m1", label: "1 month", sessions: 21 },
  { key: "m3", label: "3 months", sessions: 63 },
  { key: "m6", label: "6 months", sessions: 126 },
  { key: "y1", label: "1 year", sessions: 252 },
];

// fgByDate: { "YYYY-MM-DD": score }, spRows: [{date, close}] oldest first.
export function forwardReturns(fgByDate, spRows, score, band = 5) {
  if (score == null || !spRows?.length) return null;
  const idx = new Map(spRows.map((r, i) => [r.date, i]));
  const lo = Math.max(0, score - band), hi = Math.min(100, score + band);
  const similar = [], all = [];
  for (const [date, s] of Object.entries(fgByDate)) {
    const i = idx.get(date);
    if (i == null) continue;
    if (s >= lo && s <= hi) similar.push(i);
    all.push(i);
  }
  const stat = (ixs, h) => {
    const rets = ixs.filter((i) => i + h.sessions < spRows.length)
      .map((i) => ((spRows[i + h.sessions].close - spRows[i].close) / spRows[i].close) * 100);
    if (rets.length < 5) return { n: rets.length, median: null, positive: null };
    return { n: rets.length, median: r1(median(rets)), positive: Math.round((rets.filter((x) => x > 0).length / rets.length) * 100) };
  };
  const dates = Object.keys(fgByDate).sort();
  return {
    score, band: [lo, hi], since: dates[0] ?? null,
    days: similar.length,
    episodes: countEpisodes(similar),
    horizons: HORIZONS.map((h) => ({ key: h.key, label: h.label, similar: stat(similar, h), baseline: stat(all, h) })),
  };
}

// Group consecutive-ish matching days into distinct episodes (gap > 10 sessions).
function countEpisodes(ixs) {
  const s = [...ixs].sort((a, b) => a - b);
  let n = 0, prev = -Infinity;
  for (const i of s) { if (i - prev > 10) n++; prev = i; }
  return n;
}

// Plain-English one-liner for alerts and the dashboard.
export function contextLine(ctx) {
  const h = ctx?.horizons?.find((x) => x.key === "m6");
  if (!h?.similar?.median && h?.similar?.median !== 0) return null;
  return `Since ${ctx.since.slice(0, 4)}, when F&G was ${ctx.band[0]}–${ctx.band[1]}, the S&P was up ${h.similar.positive}% of the time 6 months later (median ${h.similar.median >= 0 ? "+" : ""}${h.similar.median}%, vs ${h.baseline.median >= 0 ? "+" : ""}${h.baseline.median}% on any day).`;
}

// Merge freshly fetched daily history into the stored long history.
export function mergeHistory(stored, history) {
  const out = { ...(stored || {}) };
  for (const p of history || []) out[p.date] = p.y;
  return out;
}

