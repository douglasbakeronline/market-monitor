import { test } from "node:test";
import assert from "node:assert/strict";
import { drawdowns, bigFalls, pullbacks, analyseIndex, stats } from "../src/dipStudy.js";

const rowsOf = (closes) => closes.map((close, i) => ({ date: `D${String(i).padStart(5, "0")}`, close }));

test("rolling 52-week drawdown uses the high within the window only", () => {
  const closes = [100, ...Array(300).fill(90)];
  const dd = drawdowns(rowsOf(closes));
  assert.equal(Math.round(dd[1]), -10);
  assert.equal(Math.round(dd[252]), 0, "the 100 close has left the window");
});

test("big falls: all days and first in a cluster", () => {
  const closes = [100, 95, 90, 90, ...Array(30).fill(90), 85];
  const { all, first } = bigFalls(rowsOf(closes), 4, 21);
  assert.deepEqual(all, [1, 2, 34]);
  assert.deepEqual(first, [1, 34]);
});

test("pullback triggers re-arm only near the high", () => {
  const closes = [...Array(260).fill(100), 94, 93, 97, 94, 99.5, 94];
  const rows = rowsOf(closes);
  const pb = pullbacks(rows, drawdowns(rows), 5, 1, 252);
  assert.deepEqual(pb, [260, 265], "97 does not re-arm, 99.5 does");
});

test("analyseIndex runs end to end and early buys win in a rising market", () => {
  const closes = [];
  for (let i = 0; i < 2000; i++) closes.push(100 * 1.0004 ** i * (i % 300 > 280 ? 0.93 : 1));
  const a = analyseIndex(rowsOf(closes));
  assert.ok(a.pullback5.triggers >= 4);
  assert.ok(a.pullback5.buyEarlyVsWait.k10.baseline.median > 0);
  assert.equal(stats([]).n, 0);
});
