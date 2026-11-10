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
<<<<<<< Updated upstream
=======

test("results check: fifths and the group note", async () => {
  const { resultsCheck } = await import("../src/surpriseStudy.js");
  const study = { cuts: { q20: 0.8, q80: 14.8 }, H5: { up: { top: { vsIdx: 1.15 }, rest: { vsIdx: -1.78 } }, down: { bottom: { vsIdx: -3.38 }, rest: { vsIdx: 0.55 } } } };
  const miss = resultsCheck({ surprisePct: -5, reaction: -6 }, study);
  assert.equal(miss.fifth, "bottom");
  assert.equal(miss.tone, "watch");
  assert.match(miss.label, /missed the forecast by 5\.0% \(bottom fifth\); the price fell 6\.0%/);
  assert.match(miss.note, /−3\.4 points/);
  const beat = resultsCheck({ surprisePct: 20, reaction: 3 }, study);
  assert.equal(beat.tone, "good");
  const mid = resultsCheck({ surprisePct: 5, reaction: 4 }, study);
  assert.equal(mid.fifth, "middle");
  assert.equal(mid.note, null);
  assert.equal(resultsCheck({ surprisePct: null }, study), null);
});
>>>>>>> Stashed changes
