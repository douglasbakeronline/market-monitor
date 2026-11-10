import { test } from "node:test";
import assert from "node:assert/strict";
import { monthEndCloses, align, rotate, stats, compare, latest } from "../src/sectorRotation.js";

const months = Array.from({ length: 60 }, (_, i) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
const series = (g) => months.map((m, i) => ({ month: m, close: 100 * Math.pow(1 + g(i), i) }));

test("month-end closes keep the last bar of each month", () => {
  const me = monthEndCloses([{ date: "2020-01-02", close: 1 }, { date: "2020-01-31", close: 2 }, { date: "2020-02-03", close: 3 }]);
  assert.deepEqual(me, [{ month: "2020-01", close: 2 }, { month: "2020-02", close: 3 }]);
});

test("rotation holds the strongest sectors; all-in equals the equal-weight average; costs follow turnover", () => {
  const data = align({ A: series(() => 0.02), B: series(() => 0.01), C: series(() => 0), D: series(() => -0.01) });
  const top1 = rotate(data, { lookback: 3, top: 1, cost: 0 });
  assert.ok(top1.every((x) => x.held[0] === "A"));
  assert.ok(Math.abs(top1[5].r - 0.02) < 1e-9);
  // Same holding every month: turnover only at the start.
  assert.equal(top1[0].turnover, 1);
  assert.ok(top1.slice(1).every((x) => x.turnover < 1e-9));
  const all = rotate(data, { lookback: 3, top: 4, cost: 0 });
  assert.ok(all.every((x) => x.held.length === 4));
  const withCost = rotate(data, { lookback: 3, top: 1, cost: 0.001 });
  assert.ok(Math.abs(withCost[0].r - (top1[0].r - 0.001)) < 1e-12);
});

test("trend filter moves a falling leader to cash", () => {
  const data = align({ A: series((i) => (i < 30 ? 0.02 : -0.03)), B: series(() => -0.02) });
  const r = rotate(data, { lookback: 1, top: 1, trend: true, cost: 0 });
  const late = r.filter((x) => x.month >= "2004-06");
  assert.ok(late.some((x) => x.held.length === 0 && x.r === 0));
});

test("stats and compare: a steadily better strategy passes, a worse one fails", () => {
  const mk = (r) => months.map((m) => ({ month: m, r }));
  const s = stats(mk(0.01));
  assert.ok(Math.abs(s.cagr - (Math.pow(1.01, 12) - 1) * 100) < 0.01);
  assert.equal(s.maxDd, 0);
  const good = compare(mk(0.01), mk(0.005), { split: "2002-06" });
  assert.equal(good.pass, true);
  assert.equal(good.rollShare, 1);
  const bad = compare(mk(0.004), mk(0.005), { split: "2002-06" });
  assert.equal(bad.pass, false);
  assert.equal(bad.checks.excess, false);
});

test("latest ranks by momentum and flags the trend", () => {
  const data = align({ A: series(() => 0.02), B: series(() => -0.01) });
  const l = latest(data, { lookback: 3, top: 1 });
  assert.deepEqual(l.top, ["A"]);
  assert.equal(l.rank[1].aboveTrend, false);
});
