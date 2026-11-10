// Swing lab round 4 (10 Nov 2026): does the size of the earnings surprise
// predict the drift after results? Douglas: "Yes, add more" (earnings-surprise
// data, option 1). Yahoo's earningsHistory gives each company's last four
// quarters of EPS against the consensus, with no key; the report date is
// taken as the highest-volume day 7 to 75 days after the quarter end (results
// day is almost always the busiest of the quarter).
//
// Pre-registered BEFORE the run (US only: UK firms report half-yearly and
// Yahoo has few UK estimates):
//   H4 (Bernard and Thomas 1989; Livnat and Mendenhall 2006): stocks in the
//   top fifth of EPS surprise beat those in the bottom fifth, against the
//   S&P 500, from the open after results to the close 60 sessions later, by
//   at least 2 points after costs, and the top fifth is ahead at 20 sessions
//   in every quarter with 100+ events.
//   H5 (does the surprise add to the price reaction?): among results days
//   that moved the price up 2%+, the top-fifth surprise does better at 60
//   sessions than the rest; among those that fell 2%+, the bottom fifth does
//   worse than the rest. Both by at least 1 point.
// Caveats written in advance: one year of data (four quarters), today's
// index members only, overlapping windows within a quarter.
import { r2 } from "./util.js";
import { COSTS } from "./swingRetune.js";

export const HORIZONS = [5, 20, 60];

// Index of the busiest day 7 to 75 calendar days after the quarter end.
export function reportDay(rows, quarter) {
  const q = Date.parse(quarter), lo = q + 7 * 864e5, hi = q + 75 * 864e5;
  let best = -1, v = -1;
  for (let i = 1; i < rows.length; i++) {
    const t = Date.parse(rows[i].date);
    if (t < lo) continue;
    if (t > hi) break;
    if ((rows[i].volume || 0) > v) { v = rows[i].volume || 0; best = i; }
  }
  return best;
}

// One event per quarter with a surprise: reaction on the report day
// (close before to close on), then net returns from the next open, after
// costs, and the index return over the same span. idx: Map date -> close.
export function surpriseEvents(rows, history, { market = "US", idx = null, symbol = null } = {}) {
  const cost = (COSTS[market] ?? 0) * 100, out = [];
  for (const h of history) {
    if (h.surprisePct == null) continue;
    const d = reportDay(rows, h.quarter);
    if (d < 1 || d + 1 >= rows.length) continue;
    const entry = rows[d + 1].open;
    if (!(entry > 0)) continue;
    const f = {}, fx = {};
    for (const k of HORIZONS) {
      const j = d + k;
      if (j >= rows.length) { f[k] = null; fx[k] = null; continue; }
      f[k] = r2((rows[j].close / entry - 1) * 100 - cost);
      const a = idx?.get(rows[d].date), b = idx?.get(rows[j].date);
      fx[k] = a && b ? r2(f[k] - (b / a - 1) * 100) : null;
    }
    out.push({ symbol, market, quarter: h.quarter, date: rows[d].date, surprisePct: h.surprisePct, reaction: r2((rows[d].close / rows[d - 1].close - 1) * 100), f, fx });
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
const avgAt = (evs, h) => { const xs = evs.map((e) => e.fx[h]).filter((v) => v != null); return { n: xs.length, vsIdx: r2(mean(xs)) }; };

// Quintiles by surprise, pooled; quarter-by-quarter spread; reaction splits.
export function analyseSurprise(events, { minQuarter = 100 } = {}) {
  const evs = events.filter((e) => e.surprisePct != null && Number.isFinite(e.surprisePct));
  const sorted = evs.map((e) => e.surprisePct).sort((a, b) => a - b);
  const cut = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const q20 = cut(0.2), q80 = cut(0.8);
  const quint = (e) => Math.min(4, Math.floor((sorted.filter((v) => v < e.surprisePct).length / sorted.length) * 5));
  for (const e of evs) e.q = quint(e);
  const quintiles = [0, 1, 2, 3, 4].map((q) => {
    const xs = evs.filter((e) => e.q === q);
    return { q: q + 1, n: xs.length, surprise: xs.length ? [r2(Math.min(...xs.map((e) => e.surprisePct))), r2(Math.max(...xs.map((e) => e.surprisePct)))] : null, reaction: r2(mean(xs.map((e) => e.reaction))),
      ...Object.fromEntries(HORIZONS.map((h) => [`h${h}`, avgAt(xs, h).vsIdx])) };
  });
  const top = evs.filter((e) => e.q === 4), bot = evs.filter((e) => e.q === 0);
  const spread = (a, b, h) => { const x = avgAt(a, h), y = avgAt(b, h); return x.vsIdx != null && y.vsIdx != null ? r2(x.vsIdx - y.vsIdx) : null; };
  const quarters = [...new Set(evs.map((e) => e.quarter.slice(0, 7)))].sort().map((qm) => {
    const a = top.filter((e) => e.quarter.startsWith(qm)), b = bot.filter((e) => e.quarter.startsWith(qm));
    return { quarter: qm, n: evs.filter((e) => e.quarter.startsWith(qm)).length, spread20: spread(a, b, 20), spread60: spread(a, b, 60) };
  });
  const counted = quarters.filter((q) => q.n >= minQuarter && q.spread20 != null);
  const H4 = { spread60: spread(top, bot, 60), spread20: spread(top, bot, 20), quarters, checks: {} };
  H4.checks = { spread: H4.spread60 != null && H4.spread60 >= 2, everyQuarter: counted.length > 0 && counted.every((q) => q.spread20 > 0) };
  H4.pass = Object.values(H4.checks).every(Boolean);

  const up = evs.filter((e) => e.reaction >= 2), down = evs.filter((e) => e.reaction <= -2);
  const H5 = {
    up: { n: up.length, top: avgAt(up.filter((e) => e.q === 4), 60), rest: avgAt(up.filter((e) => e.q !== 4), 60) },
    down: { n: down.length, bottom: avgAt(down.filter((e) => e.q === 0), 60), rest: avgAt(down.filter((e) => e.q !== 0), 60) },
  };
  H5.up.diff = H5.up.top.vsIdx != null && H5.up.rest.vsIdx != null ? r2(H5.up.top.vsIdx - H5.up.rest.vsIdx) : null;
  H5.down.diff = H5.down.bottom.vsIdx != null && H5.down.rest.vsIdx != null ? r2(H5.down.bottom.vsIdx - H5.down.rest.vsIdx) : null;
  H5.pass = H5.up.diff != null && H5.up.diff >= 1 && H5.down.diff != null && H5.down.diff <= -1;

  // Context: does the reaction alone sort returns? (up 2%+ vs down 2%+)
  const reaction = HORIZONS.map((h) => ({ h, up: avgAt(up, h).vsIdx, down: avgAt(down, h).vsIdx }));
  return { events: evs.length, cuts: { q20: r2(q20), q80: r2(q80) }, quintiles, H4, H5, reaction };
}

// Live: classify a company's latest results against the study's fifths and
// say what the study found for that group (display only; study = the saved
// data/surprise-study.json). ev: { surprisePct, reaction }.
export function resultsCheck(ev, study) {
  if (!ev || ev.surprisePct == null || !study?.cuts) return null;
  const { q20, q80 } = study.cuts;
  const fifth = ev.surprisePct < q20 ? "bottom" : ev.surprisePct >= q80 ? "top" : "middle";
  const sign = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
  const label = `EPS ${ev.surprisePct >= 0 ? "beat" : "missed"} the forecast by ${Math.abs(ev.surprisePct).toFixed(1)}%${fifth === "top" ? " (top fifth)" : fifth === "bottom" ? " (bottom fifth)" : ""}; the price ${ev.reaction >= 0 ? "rose" : "fell"} ${Math.abs(ev.reaction).toFixed(1)}% on the day`;
  let note = null, tone = "neutral";
  const h = study.H5;
  if (fifth === "bottom" && ev.reaction <= -2 && h?.down?.bottom?.vsIdx != null) {
    tone = "watch";
    note = `Weak results and a falling price: over the past year this group did ${sign(h.down.bottom.vsIdx)} points against the S&P 500 over the next 60 sessions, vs ${sign(h.down.rest.vsIdx)} for other falls (one year of data, so a pointer, not a rule).`;
  } else if (fifth === "top" && ev.reaction >= 2 && h?.up?.top?.vsIdx != null) {
    tone = "good";
    note = `Strong results and a rising price: over the past year this group did ${sign(h.up.top.vsIdx)} points against the S&P 500 over the next 60 sessions, vs ${sign(h.up.rest.vsIdx)} for other rises (one year of data, so a pointer, not a rule).`;
  }
  return { fifth, label, note, tone };
}
