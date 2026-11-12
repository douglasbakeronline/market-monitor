import { test } from "node:test";
import assert from "node:assert/strict";
import { surpriseDriftEvents, analyseSurpriseDrift, GROUPS } from "../src/surpriseDrift.js";
import { reportedSessions } from "../src/data/fundamentals.js";

const bars = (n, jumps = {}, spikes = {}) => {
  const out = [];
  let p = 100;
  for (let t = Date.UTC(2024, 0, 1); out.length < n; t += 864e5) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const i = out.length, prev = p;
    p = jumps[i] != null ? p * (1 + jumps[i] / 100) : p;
    out.push({ date: new Date(t).toISOString().slice(0, 10), open: prev, high: p, low: p, close: p, volume: 1e6 * (spikes[i] ?? 1) });
  }
  return out;
};

test("EPS figures ride along with the timed dates, surprise against the forecast", () => {
  const r = reportedSessions([{ t: 1763587200e3, actual: 1.3, estimate: 1.25 }, { t: Date.parse("2025-02-19T04:18:00Z"), actual: 0.28, estimate: 0.27 }, { t: Date.parse("2025-02-19T15:00:00Z"), actual: null, estimate: 0.17 }], "HSBA.L");
  assert.deepEqual(r.map((x) => [x.date, x.after, x.surprisePct]), [["2025-02-19", false, 3.7], ["2025-11-19", false, 4]]);
  // Forecast near zero: no surprise.
  assert.equal(reportedSessions([{ t: 1763587200e3, actual: 0.05, estimate: 0.004 }], "NVDA")[0].surprisePct, null);
});

test("events: results days (after-close next session), volume shocks away from results, random holds", () => {
  // Results after the close on day 99 -> reaction day 100 (+6% on 4x). A
  // separate shock on day 150 (+5% on 3.5x). Day 200: a shock one session
  // after a results day is not a 'shock'.
  const rows = bars(300, { 100: 6, 150: 5, 201: 5 }, { 100: 4, 150: 3.5, 201: 4 });
  const ev = surpriseDriftEvents(rows, "US", [{ date: rows[99].date, after: true, surprisePct: 8 }, { date: rows[200].date, after: false, surprisePct: -2 }], { seed: 3 });
  const res = ev.filter((e) => e.kind === "results");
  assert.deepEqual(res.map((e) => [e.date, e.move, e.volX, e.surprisePct]), [[rows[100].date, 6, 4, 8], [rows[200].date, 0, 0.95, -2]]);
  assert.deepEqual(ev.filter((e) => e.kind === "shock").map((e) => e.date), [rows[150].date]);
  // Entry at the next open (106), 20 sessions later still 106, minus 0.3% cost.
  assert.equal(res[0].f[20], -0.3);
  assert.equal(GROUPS.current(res[0]), true);
  assert.equal(GROUPS.jumpBeat(res[0]), true);
  assert.equal(GROUPS.jumpRest(res[0]), false);
  assert.ok(ev.some((e) => e.kind === "random"));
});

test("verdicts: a beat filter that only matches the current trigger fails the 0.3 gain check", () => {
  const ev = [];
  for (const y of ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"]) for (const m of ["US", "UK"]) for (let k = 0; k < 60; k++) {
    const base = { market: m, year: y, month: `${y}-05`, fx: { 20: 0, 60: 0 } };
    ev.push({ ...base, kind: "results", move: 6, volX: 4, surprisePct: 10, f: { 20: 1.2, 60: 2 } });
    ev.push({ ...base, kind: "results", move: 1, volX: 1, surprisePct: k % 2 ? 10 : -10, f: { 20: 0, 60: 0 }, fx: { 20: k % 2 ? 1 : -1, 60: k % 2 ? 3 : -3 } });
    ev.push({ ...base, kind: "shock", move: 5, volX: 4, f: { 20: 0.2, 60: 0 } });
    ev.push({ ...base, kind: "random", f: { 20: 0.1, 60: 0.2 } });
  }
  const a = analyseSurpriseDrift(ev);
  assert.equal(a.D2.pass, true);
  assert.equal(a.groups.jumpBeat.edge, 1.1);
  assert.equal(a.H8.checks.edge, true);
  assert.equal(a.H8.checks.vsCurrent, false); // same events as the current trigger
  assert.equal(a.H8.pass, false);
  assert.equal(a.H9.diff, 1);
  assert.equal(a.H9.pass, true);
  assert.equal(a.H7.spread60 > 2, true);
});
