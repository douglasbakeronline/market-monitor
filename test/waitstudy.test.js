import { test } from "node:test";
import assert from "node:assert/strict";
import { bandOf, waitOutcome, waitStudy } from "../src/waitStudy.js";
import { drawdowns } from "../src/dipStudy.js";

const rowsOf = (closes) => closes.map((close, i) => ({ date: new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10), close }));

test("bands of distance from the high", () => {
  assert.equal(bandOf(-0.4), 0);
  assert.equal(bandOf(-3.4), 3);
  assert.equal(bandOf(-4.99), 4);
  assert.equal(bandOf(-5), null, "the rule fires");
  assert.equal(bandOf(null), null);
});

test("waitOutcome: buys at the first close at the trigger, else at the window's end", () => {
  const rows = rowsOf([100, 99, 98, 97, 96, 94, 95, 101, 102]);
  const dd = drawdowns(rows);
  const hit = waitOutcome(rows, dd, 1, -5, 5);
  assert.equal(hit.hit, true);
  assert.equal(hit.days, 4); // index 5, close 94 = -6%
  assert.equal(Math.round(hit.saving * 100) / 100, Math.round((1 - 94 / 99) * 10000) / 100);
  const up = rowsOf([100, 100, 101, 102, 103, 104, 105]);
  const miss = waitOutcome(up, drawdowns(up), 1, -5, 3);
  assert.equal(miss.hit, false);
  assert.ok(miss.saving < 0, "waiting cost money");
  assert.equal(waitOutcome(up, drawdowns(up), 5, -5, 3), null, "not enough data");
});

test("waitStudy summarises each band", () => {
  // A saw-tooth: rises to a high, falls 8%, recovers, repeatedly.
  const c = [];
  for (let k = 0; k < 40; k++) for (let j = 0; j < 30; j++) c.push(100 * (j < 15 ? 1 - j * 0.0055 : 1 - (30 - j) * 0.0055) * (1 + k * 0.01));
  const s = waitStudy(rowsOf(c), { warm: 60, win: 20, horizons: { w1: 5 } });
  assert.equal(s.bands.length, 5);
  const b = s.bands[3];
  assert.ok(b.days > 0);
  assert.ok(b.wait.hitShare >= 0 && b.wait.hitShare <= 100);
  assert.ok(s.all.fwd.w1.n > 0);
});
