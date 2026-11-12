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

// Third Friday of March, June, September or December: index rebalancing and
// options expiry make these the busiest days of the quarter for many stocks,
// so they are never taken as a results day (fix after the first live check
// dated Constellation Brands' results on 18 Sep).
export const isQuadWitching = (date) => {
  const d = new Date(date + "T12:00:00Z"), m = d.getUTCMonth();
  return [2, 5, 8, 11].includes(m) && d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
};

// Index of the results day for a fiscal quarter: the known results date when
// (or the day after, if busier) when given and in range, else the busiest day 7 to 75 days after the quarter end
// (not a quad-witching day).
export function reportDay(rows, quarter, known = null) {
  const q = Date.parse(quarter), lo = q + 7 * 864e5, hi = q + 75 * 864e5;
  if (known) {
    const k = Date.parse(known);
    if (k >= lo && k <= hi) {
      // Companies that report after the close react the next day: take
      // whichever of the two days traded more.
      const i = rows.findIndex((r) => r.date >= known);
      if (i > 0) return i + 1 < rows.length && (rows[i + 1].volume || 0) > (rows[i].volume || 0) ? i + 1 : i;
    }
  }
  let best = -1, v = -1;
  for (let i = 1; i < rows.length; i++) {
    const t = Date.parse(rows[i].date);
    if (t < lo || isQuadWitching(rows[i].date)) continue;
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
  // A surprise of 25% or more either way is often a one-off (a tax charge, a
  // write-down, a gain on a sale) rather than the trading itself: say so.
  if (Math.abs(ev.surprisePct) >= 25) note = `${note ? `${note} ` : ""}A surprise this large is often a one-off item (tax, write-down or a gain), so check the results release before reading much into it.`;
  return { fifth, label, note, tone };
}

// The beat record and the next results for a company, from its last four
// quarters (history) and calendarEvents (next). Display only.
export function resultsRecord(history = [], next = null) {
  const xs = history.filter((h) => h.surprisePct != null).slice(-4);
  const beats = xs.filter((h) => h.surprisePct > 0).length;
  return { beats, of: xs.length, avgSurprise: xs.length ? Math.round((xs.reduce((a, h) => a + h.surprisePct, 0) / xs.length) * 10) / 10 : null,
    next: next && (next.date || next.epsEstimate != null) ? next : null };
}

// One short phrase for a push line or a badge; null unless flagged.
export const flagText = (rc) => (rc?.tone === "watch" ? "weak results and a fall" : rc?.tone === "good" ? "strong results and a rise" : null);

// Index-event days that trade heavily for reasons other than results: quad
// witching, the MSCI reviews (last trading day of Feb, May, Aug, Nov) and the
// Russell reconstitution (last Friday of June).
export function isIndexEventDay(rows, i) {
  const date = rows[i].date, m = +date.slice(5, 7), d = new Date(date + "T12:00:00Z");
  if (isQuadWitching(date)) return true;
  const lastOfMonth = !rows[i + 1] ? false : rows[i + 1].date.slice(0, 7) !== date.slice(0, 7);
  if ([2, 5, 8, 11].includes(m) && lastOfMonth) return true;
  return m === 6 && d.getUTCDay() === 5 && d.getUTCDate() >= 24;
}

// How far the price usually moves on results day: the reaction (close before
// to close on) for each quarter in `history` that the price rows cover. A
// known results date (`known`: the latest, or any in `dates`) is used when it
// falls 7 to 75 days after the quarter end (the next day if that traded more,
// for after-close reporters); otherwise the busiest day in that window that is
// not an index-event day. Display only: so a pick's results-day move can be
// read against its own normal range rather than as news.
// `exact`: reaction days checked by hand (data/results-dates-known.json via
// reactionDays()), used as they are, before any other date.
export function resultsMoves(rows = [], history = [], known = null, dates = [], exact = []) {
  if (!rows?.length) return null;
  const moves = [], all = [...new Set([...(dates || []), ...(known ? [known] : [])])].sort();
  for (const h of history) {
    if (!h?.quarter) continue;
    const q = Date.parse(h.quarter), lo = q + 7 * 864e5, hi = q + 75 * 864e5;
    const inWin = (x) => Date.parse(x) >= lo && Date.parse(x) <= hi;
    const x = (exact || []).find(inWin), k = all.find(inWin);
    let d = -1;
    if (x) d = rows.findIndex((r) => r.date === x);
    else if (k) d = reportDay(rows, h.quarter, k);
    else {
      let v = -1;
      for (let i = 1; i < rows.length; i++) {
        const t = Date.parse(rows[i].date);
        if (t < lo) continue;
        if (t > hi) break;
        if (isIndexEventDay(rows, i)) continue;
        if ((rows[i].volume || 0) > v) { v = rows[i].volume || 0; d = i; }
      }
    }
    if (d < 1) continue;
    moves.push({ date: rows[d].date, pct: Math.round((rows[d].close / rows[d - 1].close - 1) * 1000) / 10 });
  }
  const uniq = [...new Map(moves.map((m) => [m.date, m])).values()].slice(-4);
  if (uniq.length < 2) return null;
  const abs = uniq.map((m) => Math.abs(m.pct)).sort((a, b) => a - b);
  const mid = abs.length / 2;
  const typical = abs.length % 2 ? abs[Math.floor(mid)] : (abs[mid - 1] + abs[mid]) / 2;
  return { n: uniq.length, typical: Math.round(typical * 10) / 10, moves: uniq };
}

// Hand-kept results dates to the session that reacted: the same day for
// before-open reporters, the next session for after-close ones.
export function reactionDays(rows = [], dates = [], afterClose = false) {
  const out = [];
  for (const d of dates || []) {
    const i = rows.findIndex((r) => (afterClose ? r.date > d : r.date >= d));
    if (i > 0) out.push(rows[i].date);
  }
  return out;
}

// Yahoo's timed results dates ({ date, after }, fetchReportedDates) to the
// session that reacted: after the close -> the next session, before the open
// -> that session. Unknown times are skipped unless `assume` says which (London
// results come out by RNS before the open, so the scan passes false there).
// Feeds resultsMoves() as exact days, so the picks' "Last results" line no
// longer leans on the busiest-day guess (right only 36 to 43% of the time,
// research log 12 Nov).
export function timedReactionDays(rows = [], events = [], assume = null) {
  const out = [];
  for (const e of events || []) {
    const after = e?.after ?? assume;
    if (!e?.date || after == null) continue;
    const i = rows.findIndex((r) => (after ? r.date > e.date : r.date >= e.date));
    if (i > 0 && !out.includes(rows[i].date)) out.push(rows[i].date);
  }
  return out.sort();
}

// Hand-kept reaction days that Yahoo's timed dates contradict: a timed day
// within 10 days of a hand day but not equal to it (the same results, read
// differently). Logged nightly so a slip in data/results-dates-known.json is
// caught; hand days still win in resultsMoves().
export function dateDisagreements(hand = [], timed = []) {
  const out = [];
  for (const h of hand || []) {
    if ((timed || []).includes(h)) continue;
    const t = (timed || []).find((x) => Math.abs(Date.parse(x) - Date.parse(h)) <= 10 * 864e5);
    if (t) out.push({ hand: h, yahoo: t });
  }
  return out;
}

// "Results-day moves: typically ±4.1% (last 4: +2.4%, −5.0%, +1.1%, −6.3%)."
export function movesText(m) {
  if (!m?.n) return null;
  const s = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
  return `Results-day moves: typically ±${m.typical.toFixed(1)}% (last ${m.n}: ${m.moves.map((x) => s(x.pct)).join(", ")})`;
}
