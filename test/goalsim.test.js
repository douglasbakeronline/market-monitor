import { test } from "node:test";
import assert from "node:assert/strict";
import { monthEnds, monthlyReturns, rng, simulateGoal, cagr } from "../src/goalSim.js";

test("month ends and monthly returns", () => {
  const rows = [{ date: "2026-01-02", close: 100 }, { date: "2026-01-30", close: 110 }, { date: "2026-02-27", close: 121 }, { date: "2026-03-31", close: 108.9 }];
  const e = monthEnds(rows);
  assert.deepEqual(e.map((x) => x.m), ["2026-01", "2026-02", "2026-03"]);
  const r = monthlyReturns(e);
  assert.deepEqual(r.map((x) => Math.round(x.r * 1000) / 1000), [0.1, -0.1]);
});

test("seeded random numbers repeat", () => {
  const a = rng(7), b = rng(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("flat returns: the simulation is plain compounding", () => {
  const r = Array(120).fill(0.005);
  const s = simulateGoal({ returns: r, start: 1000, monthly: 100, goal: 5000, years: 3, paths: 50, cashShare: 0, haircut: 0 });
  // 36 months at 0.5% with 100 a month.
  let v = 1000; for (let m = 0; m < 36; m++) v = v * 1.005 + 100;
  assert.ok(Math.abs(s.bands[3].p50 - v) < 1e-6);
  assert.equal(s.bands[3].p10, s.bands[3].p90, "no spread without variation");
  assert.equal(s.hitBy[3], v >= 5000 ? 1 : 0);
  assert.equal(s.paid, 1000 + 3600);
});

test("a goal already met counts at year 0; a haircut lowers the median; cash drags", () => {
  const r = Array.from({ length: 240 }, (_, i) => (i % 12 === 0 ? -0.08 : 0.015));
  const base = simulateGoal({ returns: r, start: 10000, monthly: 0, goal: 5000, years: 10, paths: 300, seed: 3 });
  assert.equal(base.hitBy[0], 1);
  const cut = simulateGoal({ returns: r, start: 10000, monthly: 0, years: 10, paths: 300, seed: 3, haircut: 2 });
  assert.ok(cut.bands[10].p50 < base.bands[10].p50);
  const cash = simulateGoal({ returns: r, start: 10000, monthly: 0, years: 10, paths: 300, seed: 3, cashShare: 0.5 });
  assert.ok(cash.bands[10].p50 < base.bands[10].p50);
  assert.ok(base.bands[10].p10 <= base.bands[10].p50 && base.bands[10].p50 <= base.bands[10].p90);
});

test("median and slow years to the goal; null when most paths miss", () => {
  const r = Array(240).fill(0.01);
  const s = simulateGoal({ returns: r, start: 1000, monthly: 0, goal: 2000, years: 10, paths: 20, cashShare: 0 });
  assert.equal(Math.ceil(s.medianYears * 12), Math.ceil(Math.log(2) / Math.log(1.01)));
  const miss = simulateGoal({ returns: Array(240).fill(0), start: 1000, monthly: 0, goal: 2000, years: 5, paths: 20, cashShare: 0 });
  assert.equal(miss.medianYears, null);
  assert.equal(simulateGoal({ returns: [0.01], start: 1 }), null);
  assert.equal(Math.round(cagr(Array(12).fill(0.01)) * 1e4) / 1e4, Math.round((1.01 ** 12 - 1) * 1e4) / 1e4);
});

test("cash drifts towards its long-run share", () => {
  const r = Array(240).fill(0.01);
  const stay = simulateGoal({ returns: r, start: 1000, years: 5, paths: 5, cashShare: 0.15, cashRate: 0 });
  const drip = simulateGoal({ returns: r, start: 1000, years: 5, paths: 5, cashShare: 0.15, cashLong: 0.04, cashRate: 0 });
  assert.ok(drip.bands[5].p50 > stay.bands[5].p50);
});

test("history check counts real start months that reached the goal", async () => {
  const { historyCheck } = await import("../src/goalSim.js");
  // First half flat, second half +2% a month: only late starts get there in 2 years.
  const r = [...Array(48).fill(0), ...Array(48).fill(0.02)];
  const h = historyCheck({ returns: r, start: 1000, monthly: 0, goal: 1400, years: 2, cashShare: 0 });
  assert.equal(h.windows, 96 - 24 + 1);
  let exp = 0;
  for (let s = 0; s + 24 <= 96; s++) { let v = 1000, ok = false; for (let m = 0; m < 24 && !ok; m++) { v *= 1 + r[s + m]; if (v >= 1400) ok = true; } if (ok) exp++; }
  assert.equal(h.hit, exp);
  assert.equal(historyCheck({ returns: r, start: 1, goal: 2, years: 20 }), null);
});
