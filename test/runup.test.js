import { test } from "node:test";
import assert from "node:assert/strict";
import { findResultsDays, runupEvents, matchRate, analyseRunup } from "../src/runupStudy.js";

// Weekday bars from 2025-01-01; spikes: index -> volume multiple.
const bars = (n, price = () => 100, spikes = {}) => {
  const out = [];
  for (let t = Date.UTC(2025, 0, 1); out.length < n; t += 864e5) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const i = out.length;
    out.push({ date: new Date(t).toISOString().slice(0, 10), open: price(i), high: price(i), low: price(i), close: price(i), volume: 1e6 * (spikes[i] ?? 1) });
  }
  return out;
};
const idxOf = (rows, date) => rows.findIndex((r) => r.date >= date);

test("results days: the busiest day after each quarter end, only on a real volume spike", () => {
  const r0 = bars(300);
  const a = idxOf(r0, "2025-04-24"), b = idxOf(r0, "2025-07-29"), c = idxOf(r0, "2025-10-21");
  const rows = bars(300, () => 100, { [a]: 5, [b]: 4, [c]: 1.5 });
  assert.deepEqual(findResultsDays(rows), [a, b]); // c is under 2x: not a results day
});

test("run-up: buy the open K sessions before, sell the close the session before, after costs", () => {
  const r0 = bars(300);
  const d = idxOf(r0, "2025-07-29");
  // Price climbs 1 a day into results, then jumps on the day.
  const rows = bars(300, (i) => (i < d ? 100 + i * 0 + (i >= d - 5 ? i - (d - 5) : 0) : 120), { [d]: 5 });
  const ev = runupEvents(rows, "US", { days: [d], windows: [5] }).filter((e) => e.kind === "runup");
  assert.equal(ev.length, 1);
  // Entry open at d-5 = 100, exit close at d-1 = 104: +4% gross, -0.3 cost.
  assert.equal(ev[0].gross, 4);
  assert.equal(ev[0].f, 3.7);
  assert.equal(ev[0].date, rows[d - 5].date);
});

test("D1: a found day matches a real date on the same session or the next", () => {
  const r0 = bars(300);
  const a = idxOf(r0, "2025-04-24"), b = idxOf(r0, "2025-07-29");
  const rows = bars(300, () => 100, { [a]: 5, [b + 1]: 5 });
  // b reported after the close: the busy day is the next session.
  assert.deepEqual(matchRate(rows, [rows[a].date, rows[b].date, "2025-10-21"]), { n: 3, hit: 2 });
});

test("verdict: an edge only inside results season fails the same-month check", () => {
  const ev = [];
  for (const y of ["2018", "2019", "2020", "2021", "2022", "2023"]) for (const m of ["US", "UK"]) for (let k = 0; k < 60; k++) {
    // Run-ups +1 in April; random holds +1 in April too and 0 otherwise.
    ev.push({ kind: "runup", K: 5, market: m, year: y, month: `${y}-04`, f: 1, gross: 1.3, vsIdx: 0.5 });
    ev.push({ kind: "random", K: 5, market: m, year: y, month: `${y}-04`, f: 1, gross: 1.3, vsIdx: 0 });
    ev.push({ kind: "random", K: 5, market: m, year: y, month: `${y}-09`, f: 0, gross: 0.3, vsIdx: 0 });
  }
  const a = analyseRunup(ev, { match: { n: 100, hit: 90 } });
  assert.equal(a.H6.checks.edge, true);
  assert.equal(a.H6.checks.month, false);
  assert.equal(a.verdict, "fails");
  assert.equal(analyseRunup(ev, { match: { n: 100, hit: 50 } }).verdict, "dates unreliable");
});
