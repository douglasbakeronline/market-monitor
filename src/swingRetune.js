// Swing retune analysis (Douglas, 5 Nov 2026: "paper, but retune").
// Takes backtest trades tagged with what was known at the signal (setup
// score, market, uptrend, results nearby) and compares stricter setup
// variants with a random-entry baseline under the same filter, after costs.
import { r2 } from "./util.js";

// Round-trip costs on Trading 212 as a share of the entry price:
// US shares pay the 0.15% FX fee each way; UK shares pay 0.5% stamp duty on
// the purchase (no FX). Converted to R by dividing by the risk per share.
export const COSTS = { US: 0.003, UK: 0.005 };

export function costR(t) {
  if (!(t.entry > 0) || !(t.risk > 0)) return 0;
  return ((COSTS[t.market] ?? 0) * t.entry) / t.risk;
}

// The variants under test. Each is a filter on a tagged trade.
export const VARIANTS = [
  { key: "all", label: "All setups (score 65+, today's rule)", f: () => true },
  { key: "s75", label: "Score 75+", f: (t) => t.score >= 75 },
  { key: "up", label: "Uptrend only", f: (t) => t.uptrend },
  { key: "us", label: "US only", f: (t) => t.market === "US" },
  { key: "noRes", label: "No results within 10 days", f: (t) => !t.resultsNear },
  { key: "s75up", label: "Score 75+ and uptrend", f: (t) => t.score >= 75 && t.uptrend },
  { key: "s75upUS", label: "Score 75+, uptrend, US", f: (t) => t.score >= 75 && t.uptrend && t.market === "US" },
  { key: "strict", label: "Score 75+, uptrend, US, no results within 10 days", f: (t) => t.score >= 75 && t.uptrend && t.market === "US" && !t.resultsNear },
];

// Baseline trades have no setup score; they match a variant on the other
// conditions only (market, uptrend, results), so the comparison asks: does
// the setup add anything over entering at random under the same conditions?
const baseFilter = (v) => (t) => v.f({ ...t, score: 100 });

function stat(xs) {
  if (!xs.length) return { n: 0, winRate: null, avgR: null, netR: null };
  const gross = xs.reduce((a, t) => a + t.r, 0), net = xs.reduce((a, t) => a + t.r - costR(t), 0);
  return { n: xs.length, winRate: Math.round((xs.filter((t) => t.r - costR(t) > 0).length / xs.length) * 100), avgR: r2(gross / xs.length), netR: r2(net / xs.length) };
}

// A variant "clearly beats" random entry if, after costs, it earns at least
// MIN_EDGE R more per trade than the matching baseline, is positive itself,
// has a decent sample, and the edge holds in most calendar years.
export const MIN_EDGE = 0.1, MIN_TRADES = 200;

export function analyse(trades, baseline) {
  const closed = trades.filter((t) => t.status === "closed"), base = baseline.filter((t) => t.status === "closed");
  const years = [...new Set(closed.map((t) => t.exitDate.slice(0, 4)))].sort();
  return VARIANTS.map((v) => {
    const xs = closed.filter(v.f), bs = base.filter(baseFilter(v));
    const s = stat(xs), b = stat(bs);
    const edge = s.netR != null && b.netR != null ? r2(s.netR - b.netR) : null;
    const byYear = years.map((y) => {
      const a = stat(xs.filter((t) => t.exitDate.startsWith(y))), c = stat(bs.filter((t) => t.exitDate.startsWith(y)));
      return { year: y, n: a.n, netR: a.netR, baseNetR: c.netR, edge: a.netR != null && c.netR != null ? r2(a.netR - c.netR) : null };
    });
    const counted = byYear.filter((y) => y.n >= 30 && y.edge != null);
    const yearsAhead = counted.filter((y) => y.edge > 0).length;
    const clear = s.n >= MIN_TRADES && s.netR > 0 && edge >= MIN_EDGE && counted.length > 0 && yearsAhead / counted.length >= 0.75;
    return { key: v.key, label: v.label, ...s, base: b, edge, byYear, yearsAhead, yearsCounted: counted.length, clear };
  });
}

// Historical results dates aren't in our data, so project them from any known
// date on a quarterly grid (US companies report about every 91 days, usually
// within a week of the same date each year). A signal counts as "results
// near" if a projected date falls from 2 days before to window+3 days after
// it (margin for drift). Approximate: use it for US stocks only; UK
// companies report half-yearly with trading updates in between.
export function resultsNear(signalDate, anchors, window = 10) {
  const s = Date.parse(signalDate), day = 86400000;
  for (const a of anchors || []) {
    const t = Date.parse(a);
    if (!Number.isFinite(t)) continue;
    const k = Math.round((s - t) / (91 * day));
    for (const j of [k - 1, k, k + 1]) {
      const d = (t + j * 91 * day - s) / day;
      if (d >= -2 && d <= window + 3) return true;
    }
  }
  return false;
}
