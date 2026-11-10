// EV/EBITDA peer sample (display only, roadmap "Scoring follow-ups" b).
// The quick scan has no EV/EBITDA; the nightly deepening fetches it only for the
// ~100 highest scorers, so a median from those alone is biased low. Instead the
// scan refreshes a rotating sample of every company (missing first, then
// oldest), keeps each value for MAX_AGE days in data/ev-sample.json, and only
// publishes a sector median once most of the universe is covered. Not in the
// score: using it there is a rule change for Douglas to agree.
import { median, r1 } from "./util.js";
import { gicsSector, regionOf } from "./sectorValue.js";
import { longTermLive } from "./research.js";

export const MAX_AGE = 45, PER_NIGHT = 120, MIN_EV_PEERS = 8, MIN_COVERAGE = 0.6;

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Symbols to refresh tonight: never fetched first, then the oldest, skipping
// any refreshed within the last week (deepened stocks refresh themselves).
export function pickRefresh(symbols, cache, today, n = PER_NIGHT) {
  const age = (s) => (cache[s]?.date ? days(cache[s].date, today) : Infinity);
  return symbols.filter((s) => age(s) >= 7).sort((a, b) => age(b) - age(a) || a.localeCompare(b)).slice(0, n);
}

// A value outside 0 to 200 is a data error or a meaningless multiple (negative
// EBITDA); it is stored as null so the stock is not fetched again every night.
export const cleanEv = (x) => (Number.isFinite(x) && x > 0 && x <= 200 ? r1(x) : null);

export function record(cache, symbol, ev, today) {
  cache[symbol] = { ev: cleanEv(ev), date: today };
  return cache;
}

// The cached value, if fetched within MAX_AGE days.
export const freshEv = (cache, symbol, today) => (cache[symbol]?.date && days(cache[symbol].date, today) <= MAX_AGE ? cache[symbol].ev : null);

// Drop symbols that have left the universe so the file does not grow forever.
export function prune(cache, symbols) {
  const keep = new Set(symbols);
  for (const s of Object.keys(cache)) if (!keep.has(s)) delete cache[s];
  return cache;
}

// rows: [{ symbol, sector, market, trust }] -> { coverage, n, ready, pooled: {sector: {ev, n}}, US: {...}, Europe: {...} }
// A sector median needs MIN_EV_PEERS fresh values, and none is published until
// MIN_COVERAGE of the universe has a fresh fetch (positive or not).
export function evMedians(rows, cache, today) {
  const fresh = (s) => cache[s]?.date && days(cache[s].date, today) <= MAX_AGE;
  const scored = rows.filter((r) => !r.trust);
  const covered = scored.filter((r) => fresh(r.symbol));
  const coverage = scored.length ? covered.length / scored.length : 0;
  const build = (list) => {
    const by = {};
    for (const r of list) {
      const s = gicsSector(r.sector), ev = cache[r.symbol]?.ev;
      if (!s || s === "Financials" || !(ev > 0)) continue;
      (by[s] ??= []).push(ev);
    }
    const out = {};
    for (const [s, xs] of Object.entries(by)) if (xs.length >= MIN_EV_PEERS) out[s] = { ev: r1(median(xs)), n: xs.length };
    return out;
  };
  const ready = coverage >= MIN_COVERAGE;
  return {
    coverage: Math.round(coverage * 100), n: covered.length, ready,
    pooled: ready ? build(covered) : {},
    US: ready ? build(covered.filter((r) => regionOf(r.market) === "US")) : {},
    Europe: ready ? build(covered.filter((r) => regionOf(r.market) === "Europe")) : {},
  };
}

// The stock's own value (deepened data first, then the sample) against its
// region's sector median, or the pooled one. null when either side is missing.
export function evPeer(ev, sector, market, med) {
  const s = gicsSector(sector);
  // Banks and insurers: EV/EBITDA means little (debt is their raw material).
  if (!(ev > 0) || !s || s === "Financials" || !med?.ready) return null;
  const region = regionOf(market);
  const m = med[region]?.[s] ?? med.pooled?.[s];
  if (!m) return null;
  const d = Math.round((ev / m.ev - 1) * 100);
  const where = med[region]?.[s] ? (region === "US" ? "US " : "European ") : "";
  return { ev: r1(ev), median: m.ev, n: m.n, region: med[region]?.[s] ? region : null,
    note: `EV/EBITDA ${r1(ev).toFixed(1)} vs the ${where}${s} median of ${m.ev.toFixed(1)} (${m.n} stocks): ${Math.abs(d) < 5 ? "in line with peers" : `${Math.abs(d)}% ${d < 0 ? "below" : "above"}`} (not in the score yet).` };
}

// EV view (display only, step 2 of "Scoring follow-ups" b): what the live
// score and verdict would be if EV/EBITDA were scored against the region's
// sector median, like P/E, using the sample value where the quick scan has
// none. Not in the score: a rule change for Douglas to agree.
// f, t: the stock's data; peer: from peerFor(); ep: from evPeer(); live: the
// live longTermLive() result.
export function evView(f, t, peer, ep, live) {
  if (!peer || !ep || !live || live.score == null || live.trust) return null;
  const alt = longTermLive({ ...f, evToEbitda: ep.ev }, t, { ...peer, evToEbitda: ep.median });
  if (alt.score == null) return null;
  const val = (r) => r.pillars.find((p) => p.key === "value")?.score ?? null;
  const changed = alt.verdict !== live.verdict;
  const note = alt.score === live.score && !changed
    ? `Scoring EV/EBITDA against peers would leave the score at ${live.score}.`
    : `Scoring EV/EBITDA against peers would give ${alt.score}, ${changed ? alt.verdict : `still ${alt.verdict}`} (now ${live.score}${changed ? `, ${live.verdict}` : ""}).`;
  return { score: alt.score, verdict: alt.verdict, value: val(alt), scoreNow: live.score, verdictNow: live.verdict, valueNow: val(live), changed, note };
}

// Scan-wide summary of the EV view: how many verdicts would change, and which.
// rows: [{ symbol, view, deep }] (view from evView, or null; deep: a full score).
export function evViewSummary(rows) {
  const xs = rows.filter((r) => r.view);
  const ch = xs.filter((r) => r.view.changed);
  const diffs = xs.map((r) => r.view.score - r.view.scoreNow);
  const moves = {};
  for (const r of ch) { const k = `${r.view.verdictNow} → ${r.view.verdict}`; moves[k] = (moves[k] ?? 0) + 1; }
  return {
    n: xs.length, changed: ch.length, full: xs.filter((r) => r.deep).length, changedFull: ch.filter((r) => r.deep).length,
    up: diffs.filter((d) => d > 0).length, down: diffs.filter((d) => d < 0).length,
    avgShift: diffs.length ? r1(diffs.reduce((a, d) => a + d, 0) / diffs.length) : null,
    toGood: ch.filter((r) => r.view.verdict === "Good entry").map((r) => r.symbol),
    fromGood: ch.filter((r) => r.view.verdictNow === "Good entry").map((r) => r.symbol),
    moves,
  };
}
