import { test } from "node:test";
import assert from "node:assert/strict";
import { reportDay, surpriseEvents, analyseSurprise } from "../src/surpriseStudy.js";
import { parseEarningsHistory } from "../src/data/fundamentals.js";

const bars = (n, f = () => 100, vol = () => 1e6) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10), open: f(i), high: f(i), low: f(i), close: f(i), volume: vol(i) }));

test("earningsHistory parsing: dates, surprise from Yahoo or computed", () => {
  const h = parseEarningsHistory([
    { quarter: { raw: 1751241600 }, epsActual: { raw: 1.1 }, epsEstimate: { raw: 1 }, surprisePercent: { raw: 0.1 } },
    { quarter: { raw: 1743379200 }, epsActual: { raw: 0.9 }, epsEstimate: { raw: 1 } },
    { quarter: { raw: 1735603200 }, epsActual: {}, epsEstimate: { raw: 1 } },
  ]);
  assert.equal(h.length, 2);
  assert.equal(h[0].quarter, "2025-03-31");
  assert.equal(h[0].surprisePct, -10);
  assert.equal(h[1].surprisePct, 10);
});

test("report day is the busiest day 7 to 75 days after the quarter end", () => {
  const rows = bars(200, () => 100, (i) => (i === 40 ? 9e6 : i === 3 ? 20e6 : i === 120 ? 30e6 : 1e6));
  assert.equal(reportDay(rows, "2026-01-01"), 40);
});

test("events: reaction on the report day, returns from the next open after costs, against the index", () => {
  const rows = bars(200, (i) => (i < 40 ? 100 : i === 40 ? 105 : 110), (i) => (i === 40 ? 9e6 : 1e6));
  const idx = new Map(rows.map((r) => [r.date, 1000]));
  const [e] = surpriseEvents(rows, [{ quarter: "2026-01-01", surprisePct: 12 }], { idx });
  assert.equal(e.reaction, 5);
  assert.equal(e.f[20], r2(0 - 0.3));
  assert.equal(e.fx[20], e.f[20]);
  function r2(x) { return Math.round(x * 100) / 100; }
});

test("analysis: a clean surprise effect passes H4 and H5; quintiles cover all events", () => {
  const evs = [];
  for (const qm of ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]) for (let i = 0; i < 150; i++) {
    const s = (i % 50) - 25, v = s / 5; // returns rise with surprise
    const reaction = i % 2 ? 3 : -3;
    evs.push({ quarter: qm, surprisePct: s, reaction, f: { 5: v, 20: v, 60: v }, fx: { 5: v, 20: v, 60: v } });
  }
  const a = analyseSurprise(evs);
  assert.equal(a.quintiles.reduce((s, q) => s + q.n, 0), evs.length);
  assert.ok(a.H4.spread60 >= 2);
  assert.equal(a.H4.pass, true);
  assert.equal(a.H5.pass, true);
  const flat = analyseSurprise(evs.map((e) => ({ ...e, fx: { 5: 0, 20: 0, 60: 0 } })));
  assert.equal(flat.H4.pass, false);
  assert.equal(flat.H5.pass, false);
});

test("results check: fifths and the group note", async () => {
  const { resultsCheck } = await import("../src/surpriseStudy.js");
  const study = { cuts: { q20: 0.8, q80: 14.8 }, H5: { up: { top: { vsIdx: 1.15 }, rest: { vsIdx: -1.78 } }, down: { bottom: { vsIdx: -3.38 }, rest: { vsIdx: 0.55 } } } };
  const miss = resultsCheck({ surprisePct: -5, reaction: -6 }, study);
  assert.equal(miss.fifth, "bottom");
  assert.equal(miss.tone, "watch");
  assert.match(miss.label, /missed the forecast by 5\.0% \(bottom fifth\); the price fell 6\.0%/);
  // Ten years (round 7, 12 Nov) replace the one-year figures (−3.4) in the note.
  assert.match(miss.note, /ten years/);
  assert.match(miss.note, /0\.4 points/);
  assert.doesNotMatch(miss.note, /−3\.4/);
  const beat = resultsCheck({ surprisePct: 20, reaction: 3 }, study);
  assert.equal(beat.tone, "good");
  assert.match(beat.note, /ten years/);
  const mid = resultsCheck({ surprisePct: 5, reaction: 4 }, study);
  assert.equal(mid.fifth, "middle");
  assert.equal(mid.note, null);
  assert.equal(resultsCheck({ surprisePct: null }, study), null);
});

test("report day skips quad-witching Fridays and prefers a known results date", async () => {
  const { reportDay, isQuadWitching } = await import("../src/surpriseStudy.js");
  assert.equal(isQuadWitching("2026-09-18"), true);
  assert.equal(isQuadWitching("2026-09-11"), false);
  assert.equal(isQuadWitching("2026-10-16"), false);
  const rows = Array.from({ length: 120 }, (_, i) => ({ date: new Date(Date.UTC(2026, 7, 31) + i * 864e5).toISOString().slice(0, 10), close: 1, volume: 1e6 }));
  const qw = rows.findIndex((r) => r.date === "2026-09-18"), res = rows.findIndex((r) => r.date === "2026-10-06");
  rows[qw].volume = 9e6; rows[res].volume = 5e6;
  assert.equal(reportDay(rows, "2026-08-31"), res);
  assert.equal(reportDay(rows, "2026-08-31", "2026-10-02"), rows.findIndex((r) => r.date === "2026-10-02"));
  assert.equal(reportDay(rows, "2026-08-31", "2027-03-01"), res);
  // After-close reporter: the busier next day is the reaction day.
  const k = rows.findIndex((r) => r.date === "2026-10-20");
  rows[k + 1].volume = 7e6;
  assert.equal(reportDay(rows, "2026-08-31", "2026-10-20"), k + 1);
});

test("results record: beats of the last four, average surprise, next results; flag text", async () => {
  const { resultsRecord, flagText } = await import("../src/surpriseStudy.js");
  const { parseNextResults } = await import("../src/data/fundamentals.js");
  const h = [-2, 5, 8, 3, 10].map((v, i) => ({ quarter: `2025-0${i + 1}-30`, surprisePct: v }));
  const r = resultsRecord(h, { date: "2027-01-28", epsEstimate: 1.2 });
  assert.equal(r.beats, 4);
  assert.equal(r.of, 4);
  assert.equal(r.avgSurprise, 6.5);
  assert.equal(r.next.date, "2027-01-28");
  assert.equal(resultsRecord([], null).next, null);
  assert.equal(flagText({ tone: "watch" }), "weak results and a fall");
  assert.equal(flagText({ tone: "neutral" }), null);
  const t = Math.floor(Date.now() / 1000) + 30 * 86400;
  const n = parseNextResults({ earningsDate: [{ raw: t }], earningsAverage: { raw: 1.5 }, earningsLow: { raw: 1.2 }, earningsHigh: { raw: 1.8 } });
  assert.equal(n.epsEstimate, 1.5);
  assert.equal(n.date, new Date(t * 1000).toISOString().slice(0, 10));
  assert.equal(parseNextResults(null), null);
});

test("a very large surprise carries a one-off caveat", async () => {
  const { resultsCheck } = await import("../src/surpriseStudy.js");
  const study = { cuts: { q20: 0.8, q80: 14.8 }, H5: { up: { top: { vsIdx: 1 }, rest: { vsIdx: 0 } }, down: { bottom: { vsIdx: -3 }, rest: { vsIdx: 0 } } } };
  assert.match(resultsCheck({ surprisePct: -29.3, reaction: -4 }, study).note, /one-off item/);
  assert.match(resultsCheck({ surprisePct: 30, reaction: 0.5 }, study).note, /^A surprise this large/);
  assert.doesNotMatch(resultsCheck({ surprisePct: -5, reaction: -4 }, study).note, /one-off/);
});

test("results-day moves: busiest day after each quarter, typical size", async () => {
  const { resultsMoves, movesText } = await import("../src/surpriseStudy.js");
  // Daily rows across a year; spikes 30 days after each quarter end.
  const rows = [];
  let px = 100;
  for (let t = Date.parse("2025-11-03"); t <= Date.parse("2026-11-09"); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const spike = { "2026-01-30": 1.05, "2026-04-30": 0.94, "2026-07-30": 1.02, "2026-10-30": 0.9 }[date];
    px = spike ? px * spike : px;
    rows.push({ date, close: px, volume: spike ? 9e6 : 1e6 });
  }
  const hist = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].map((quarter) => ({ quarter }));
  const m = resultsMoves(rows, hist);
  assert.equal(m.n, 4);
  assert.deepEqual(m.moves.map((x) => x.pct), [5, -6, 2, -10]);
  assert.equal(m.typical, 5.5);
  assert.equal(movesText(m), "Results-day moves: typically ±5.5% (last 4: +5.0%, −6.0%, +2.0%, −10.0%)");
  assert.equal(resultsMoves(rows, hist.slice(-1)), null);
  assert.equal(movesText(null), null);
});

test("results-day moves skip index-event days and use known dates", async () => {
  const { resultsMoves, isIndexEventDay } = await import("../src/surpriseStudy.js");
  const rows = [];
  let px = 100;
  const move = { "2026-02-10": 1.05, "2026-05-05": 0.96, "2026-05-29": 1.03 };
  const vol = { "2026-02-10": 5e6, "2026-05-05": 5e6, "2026-05-29": 9e6 };
  for (let t = Date.parse("2026-01-02"); t <= Date.parse("2026-06-30"); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10), dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    px *= move[date] ?? 1;
    rows.push({ date, close: px, volume: vol[date] ?? 1e6 });
  }
  const i = rows.findIndex((r) => r.date === "2026-05-29");
  assert.equal(isIndexEventDay(rows, i), true, "MSCI review day");
  assert.equal(isIndexEventDay(rows, i - 1), false);
  const hist = [{ quarter: "2025-12-31" }, { quarter: "2026-03-31" }];
  assert.deepEqual(resultsMoves(rows, hist).moves.map((m) => [m.date, m.pct]), [["2026-02-10", 5], ["2026-05-05", -4]]);
  // A known date wins, even on an index-event day.
  assert.deepEqual(resultsMoves(rows, hist, null, ["2026-05-29"]).moves.map((m) => m.date), ["2026-02-10", "2026-05-29"]);
});

test("hand-kept results dates: picks, bench and research list only, valid past dates", async () => {
  const { readFileSync } = await import("node:fs");
  const { PLAN } = await import("../src/plan.js");
  const { dates } = JSON.parse(readFileSync(new URL("../data/results-dates-known.json", import.meta.url)));
  const list = JSON.parse(readFileSync(new URL("../research-list.json", import.meta.url))).stocks.map((x) => x.symbol);
  const names = new Set([...PLAN.picks.map((p) => p.symbol), ...PLAN.bench, ...list]);
  for (const [sym, ds] of Object.entries(dates)) {
    assert.ok(names.has(sym), `${sym} is a pick, bench or research-list name`);
    assert.deepEqual([...ds].sort(), ds, `${sym} dates sorted`);
    for (const d of ds) assert.match(d, /^\d{4}-\d{2}-\d{2}$/), assert.ok(!Number.isNaN(Date.parse(d)));
  }
});

test("hand-kept dates: exact reaction days beat the busier-day rule both ways", async () => {
  const { resultsMoves, reactionDays } = await import("../src/surpriseStudy.js");
  // STZ: after the close on 30 Jun (quarter-end, busiest day); the reaction is 1 Jul.
  const rows = bars(200, (i) => 100 + (i >= 181 ? 6 : 0) + (i >= 120 ? 2 : 0), (i) => (i === 180 ? 9e6 : i === 121 ? 9e6 : 1e6));
  assert.equal(rows[180].date, "2026-06-30");
  const amc = reactionDays(rows, ["2026-06-30"], true);
  assert.deepEqual(amc, ["2026-07-01"]);
  const m = resultsMoves(rows, [{ quarter: "2026-02-28" }, { quarter: "2026-05-31" }], null, ["2026-04-30", "2026-06-30"], amc);
  assert.equal(m.moves.at(-1).date, "2026-07-01");
  assert.equal(m.moves.at(-1).pct, 5.9);
  // Before-open reporter on 1 May (index 120): the busier next day (2 May) is not taken.
  const bmo = reactionDays(rows, ["2026-05-01"], false);
  assert.deepEqual(bmo, ["2026-05-01"]);
  const m2 = resultsMoves(rows, [{ quarter: "2026-03-31" }, { quarter: "2026-06-30" }], null, ["2026-05-01"], bmo);
  assert.equal(m2.moves[0].date, "2026-05-01");
  assert.equal(m2.moves[0].pct, 2);
  // Without the exact day the old rule takes 2 May.
  assert.equal(resultsMoves(rows, [{ quarter: "2026-03-31" }, { quarter: "2026-06-30" }], null, ["2026-05-01"]).moves[0].date, "2026-05-02");
});

test("timed Yahoo dates: reaction sessions for the picks' results-day moves", async () => {
  const { resultsMoves, timedReactionDays } = await import("../src/surpriseStudy.js");
  const rows = bars(200, (i) => 100 + (i >= 181 ? 6 : 0) + (i >= 120 ? 2 : 0), (i) => (i === 180 ? 9e6 : i === 121 ? 9e6 : 1e6));
  const ev = [{ date: "2026-06-30", after: true }, { date: "2026-05-01", after: false }, { date: "2026-03-02", after: null }];
  // After the close -> next session; before the open -> same session; unknown time skipped.
  assert.deepEqual(timedReactionDays(rows, ev), ["2026-05-01", "2026-07-01"]);
  // London: unknown times read as before the open when assumed.
  assert.deepEqual(timedReactionDays(rows, [{ date: "2026-05-01", after: null }], false), ["2026-05-01"]);
  // A date past the last bar or before the first gives nothing; duplicates collapse.
  assert.deepEqual(timedReactionDays(rows, [{ date: "2030-01-01", after: false }, { date: "2026-05-01", after: false }, { date: "2026-05-01", after: false }]), ["2026-05-01"]);
  assert.deepEqual(timedReactionDays(rows, []), []);
  // Fed to resultsMoves as exact days, the busier wrong day (2 May) is not taken.
  const m = resultsMoves(rows, [{ quarter: "2026-03-31" }, { quarter: "2026-05-31" }], null, [], timedReactionDays(rows, ev));
  assert.deepEqual(m.moves.map((x) => [x.date, x.pct]), [["2026-05-01", 2], ["2026-07-01", 5.9]]);
});

test("hand-kept results days that Yahoo's timed dates contradict", async () => {
  const { dateDisagreements } = await import("../src/surpriseStudy.js");
  assert.deepEqual(dateDisagreements(["2026-07-01", "2026-04-09"], ["2026-04-09", "2026-07-02"]), [{ hand: "2026-07-01", yahoo: "2026-07-02" }]);
  // A hand day with no timed date near it is not a disagreement (Yahoo just lacks it).
  assert.deepEqual(dateDisagreements(["2026-01-08"], ["2026-04-09"]), []);
  assert.deepEqual(dateDisagreements([], ["2026-04-09"]), []);
  assert.deepEqual(dateDisagreements(["2026-04-09"], []), []);
});
