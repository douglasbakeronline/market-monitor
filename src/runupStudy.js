// Swing lab round 5 (12 Nov 2026): the run-up INTO results (the earnings
// announcement premium). Douglas, 12 Nov: "I want a better signal on upcoming
// results"; Claude said the direction of the results-day jump cannot be
// called, and offered to test the one pre-results effect with decent evidence:
// stocks have tended to rise in the days before they report (Frazzini and
// Lamont 2007; Savor and Wilson 2016; Barber, De George, Lehavy and Trueman
// 2013), an effect that shrank in the US after about 2004 (Heitz,
// Narayanamoorthy and Zekhnini 2020) but looked alive in the UK. Research log
// 10 Nov already summarises the literature.
//
// The trade: buy at the open K sessions before the results reaction day and
// sell at the close the session before it, so the position never holds
// through the announcement. Same costs as the other setups (US 0.3%, UK 0.5%
// round trip).
//
// Pre-registered BEFORE the run (nothing tuned afterwards):
//   H6 (primary, K = 5): against random 5-session holds on the same stocks
//     (also after costs), the run-up clears the round-1 bar (LAB_BAR): an edge
//     of 0.4+ points a trade, a positive average after costs, 300+ trades,
//     ahead in 3 of every 4 years with 50+ trades, ahead in each market with
//     100+ trades, ahead in both halves (2017-2021, 2022-2026), and ahead of
//     random holds started in the same calendar month (results cluster in
//     season, so a month effect must not pass for a results effect).
//   D1 (data check): results days are found from volume (the busiest day 7 to
//     75 days after each calendar quarter end, at least 2x the previous 50
//     sessions' volume, index event days skipped). On US stocks the found days
//     must match the real dates kept in history/results-dates.json (same
//     session, or the next one for after-close reporters) at least 70% of the
//     time, or the verdict is "dates unreliable" whatever H6 says.
// Exploratory only (shown, never a verdict): K = 3 and K = 10, each market on
// its own, the average before costs, and the return against the home index.
// Caveats written in advance: today's index members only (survivorship), UK
// half-yearly reporters' trading updates count as results days, and a
// volume-found date is known only afterwards (in real life the date is
// published weeks ahead, so the trade itself is possible).
import { r2 } from "./util.js";
import { COSTS } from "./swingRetune.js";
import { LAB_BAR } from "./swingLab.js";
import { isIndexEventDay } from "./surpriseStudy.js";

export const RUNUP = { primary: 5, windows: [3, 5, 10], minVolX: 2, matchBar: 0.7 };

// Calendar quarter ends covered by the rows (YYYY-MM-DD).
function quarterEnds(rows) {
  if (!rows.length) return [];
  const y0 = +rows[0].date.slice(0, 4) - 1, y1 = +rows.at(-1).date.slice(0, 4);
  const out = [];
  for (let y = y0; y <= y1; y++) for (const md of ["03-31", "06-30", "09-30", "12-31"]) out.push(`${y}-${md}`);
  return out;
}

// Indices of results reaction days, found from volume (see D1 above).
export function findResultsDays(rows, { minVolX = RUNUP.minVolX } = {}) {
  const n = rows.length, avg = new Array(n).fill(null);
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i >= 50) avg[i] = s / 50;
    s += rows[i].volume || 0;
    if (i >= 50) s -= rows[i - 50].volume || 0;
  }
  const out = [];
  for (const qe of quarterEnds(rows)) {
    const q = Date.parse(qe), lo = q + 7 * 864e5, hi = q + 75 * 864e5;
    let best = -1, v = -1;
    for (let i = 1; i < n; i++) {
      const t = Date.parse(rows[i].date);
      if (t < lo) continue;
      if (t > hi) break;
      if (isIndexEventDay(rows, i)) continue;
      if ((rows[i].volume || 0) > v) { v = rows[i].volume || 0; best = i; }
    }
    if (best > 0 && avg[best] > 0 && v >= minVolX * avg[best]) out.push(best);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// Run-up trades and random holds for one stock. idx: Map date -> home index
// close. Returns events { kind: "runup" | "random", K, f (net % after costs),
// gross, vsIdx, date (entry), month, year, market, symbol }.
export function runupEvents(rows, market, { idx = null, seed = 1, symbol = null, days = null, windows = RUNUP.windows } = {}) {
  const n = rows.length, cost = COSTS[market] ?? 0, out = [];
  let x = seed >>> 0;
  const rand = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const hold = (e, last, kind, K) => {
    const entry = rows[e]?.open, exit = rows[last]?.close;
    if (!(entry > 0) || !(exit > 0) || e < 60) return;
    const gross = exit / entry - 1;
    const a = idx?.get(rows[e - 1]?.date), b = idx?.get(rows[last].date);
    out.push({ kind, K, symbol, market, date: rows[e].date, month: rows[e].date.slice(0, 7), year: rows[e].date.slice(0, 4),
      gross: r2(gross * 100), f: r2((gross - cost) * 100), vsIdx: a && b ? r2((gross - cost - (b / a - 1)) * 100) : null });
  };
  for (const d of days ?? findResultsDays(rows)) for (const K of windows) hold(d - K, d - 1, "runup", K);
  for (let i = 60; i < n; i++) if (rand() < 0.1) for (const K of windows) if (i + K - 1 < n) hold(i, i + K - 1, "random", K);
  return out;
}

// D1: share of real results dates the volume method finds. known: real dates
// (YYYY-MM-DD) inside the rows' span; a match is the same session or the next.
export function matchRate(rows, known = []) {
  const found = new Set(findResultsDays(rows).map((i) => rows[i].date));
  let n = 0, hit = 0;
  for (const k of known) {
    const i = rows.findIndex((r) => r.date >= k);
    if (i < 60 || i >= rows.length - 1) continue;
    n++;
    if (found.has(rows[i].date) || found.has(rows[i + 1]?.date)) hit++;
  }
  return { n, hit };
}

const mean = (xs) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
function cmp(evs, rnd) {
  const a = evs.map((e) => e.f), b = rnd.map((e) => e.f), ma = mean(a), mb = mean(b);
  return { n: a.length, avg: r2(ma), base: r2(mb), edge: ma != null && mb != null ? r2(ma - mb) : null, win: a.length ? Math.round((a.filter((v) => v > 0).length / a.length) * 100) : null };
}

// Verdicts and tables. match: { n, hit } from matchRate summed over US stocks.
export function analyseRunup(all, { match = null, bar = LAB_BAR, K = RUNUP.primary } = {}) {
  const at = (k) => all.filter((e) => e.K === k);
  const ev = (k, f = () => true) => at(k).filter((e) => e.kind === "runup" && f(e));
  const rn = (k, f = () => true) => at(k).filter((e) => e.kind === "random" && f(e));
  const table = (k, f = () => true) => cmp(ev(k, f), rn(k, f));
  const years = [...new Set(all.map((e) => e.year))].sort();
  const byYear = years.map((y) => ({ year: y, ...table(K, (e) => e.year === y) }));
  const byMarket = ["US", "UK"].map((m) => ({ market: m, ...table(K, (e) => e.market === m) }));
  const halves = [["2017-2021", (e) => e.year <= "2021"], ["2022-2026", (e) => e.year >= "2022"]].map(([label, f]) => ({ label, ...table(K, f) }));
  // Same-month baseline: each run-up against random holds that started in the
  // same calendar month (all stocks).
  const mm = new Map();
  for (const e of rn(K)) { const g = mm.get(e.month) || [0, 0]; g[0] += e.f; g[1]++; mm.set(e.month, g); }
  const mx = ev(K).map((e) => { const g = mm.get(e.month); return g && g[1] >= 20 ? e.f - g[0] / g[1] : null; }).filter((v) => v != null);
  const monthEdge = mx.length ? r2(mean(mx)) : null;
  const counted = byYear.filter((r) => r.n >= bar.minYearTrades && r.edge != null);
  const ahead = counted.filter((r) => r.edge > 0).length;
  const t = table(K);
  const checks = {
    edge: t.edge != null && t.edge >= bar.minEdge,
    positive: t.avg != null && t.avg > 0,
    sample: t.n >= bar.minTrades,
    years: counted.length > 0 && ahead / counted.length >= bar.yearShare,
    markets: byMarket.filter((m) => m.n >= 100).every((m) => m.edge > 0),
    halves: halves.every((h) => h.edge != null && h.edge > 0),
    month: monthEdge != null && monthEdge > 0,
  };
  const D1 = match ? { ...match, rate: match.n ? r2(match.hit / match.n) : null } : null;
  if (D1) D1.pass = D1.rate != null && D1.rate >= RUNUP.matchBar;
  const H6 = { K, ...t, monthEdge, byYear, byMarket, halves, years: { ahead, counted: counted.length }, checks, pass: Object.values(checks).every(Boolean) };
  const verdict = D1 && !D1.pass ? "dates unreliable" : H6.pass ? "passes" : "fails";
  const explore = RUNUP.windows.flatMap((k) => ["US", "UK"].map((m) => {
    const xs = ev(k, (e) => e.market === m);
    return { K: k, market: m, ...table(k, (e) => e.market === m), gross: r2(mean(xs.map((e) => e.gross))), vsIdx: r2(mean(xs.map((e) => e.vsIdx).filter((v) => v != null))) };
  }));
  return { verdict, D1, H6, explore, counts: { runup: ev(K).length, random: rn(K).length } };
}
