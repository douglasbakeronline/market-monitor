import { test } from "node:test";
import assert from "node:assert/strict";
import { tierEvents, simulate, rollingCompare, align, volProxy } from "../src/tierBacktest.js";
import { drawdowns } from "../src/dipStudy.js";

// Daily rows with a calendar-ish date so months change every 21 bars.
const day = (i) => { const m = Math.floor(i / 21); return `${2000 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-${String((i % 21) + 1).padStart(2, "0")}`; };
const rowsOf = (closes, confirmAt = () => true) => closes.map((close, i) => ({ date: day(i), close, confirm: confirmAt(i) }));

// Flat at 100, a dip to 75 and back, then flat again.
const dipCloses = () => {
  const c = Array(300).fill(100);
  for (let k = 1; k <= 25; k++) c.push(100 - k);      // down to 75
  for (let k = 1; k <= 25; k++) c.push(75 + k);       // back to 100
  return c.concat(Array(300).fill(100));
};

test("tier events: one episode per level, confirmation can lag", () => {
  const rows = rowsOf(dipCloses(), (i) => i >= 318); // fear only confirms late
  const ev = tierEvents(rows, [-10, -20, -30]);
  assert.equal(ev[-10].episodes, 1);
  assert.equal(ev[-20].episodes, 1);
  assert.equal(ev[-30].episodes, 0);
  assert.equal(ev[-10].confirmed, 1);
  assert.equal(ev[-10].daysToConfirm.median, 8, "first hit at bar 310, confirmed at 318");
  assert.ok(ev[-10].confirmVsFirst.median < 0, "confirmation bought cheaper on the way down");
});

test("simulate: reserve is deployed at tiers and beats all-in on a V-shaped dip", () => {
  const rows = rowsOf(dipCloses());
  const dd = drawdowns(rows);
  const allIn = simulate(rows, dd, 252, rows.length - 1, { reserve: 0 });
  const res = simulate(rows, dd, 252, rows.length - 1, { reserve: 0.15, levels: [-10, -20], sweepAfter: 0 });
  assert.equal(res.deployed, 2);
  assert.ok(res.wealth > allIn.wealth);
  assert.equal(allIn.paid, res.paid);
});

test("simulate: without a dip the reserve drags in a rising market, and sweeps cut the drag", () => {
  const c = []; for (let i = 0; i < 1600; i++) c.push(100 * 1.0004 ** i);
  const rows = rowsOf(c);
  const dd = drawdowns(rows);
  const allIn = simulate(rows, dd, 252, 1599, { reserve: 0 }).wealth;
  const hold = simulate(rows, dd, 252, 1599, { reserve: 0.15, sweepAfter: 0 }).wealth;
  const swept = simulate(rows, dd, 252, 1599, { reserve: 0.15, sweepAfter: 252, sweepFrac: 0.5 }).wealth;
  assert.ok(hold < swept && swept < allIn);
});

test("simulate: unconfirmed tiers are skipped when confirmation is required", () => {
  const rows = rowsOf(dipCloses(), () => false);
  const dd = drawdowns(rows);
  assert.equal(simulate(rows, dd, 252, rows.length - 1, { levels: [-10], sweepAfter: 0 }).deployed, 0);
  assert.equal(simulate(rows, dd, 252, rows.length - 1, { levels: [-10], sweepAfter: 0, confirm: false }).deployed, 1);
});

test("cash earns its yield", () => {
  const rows = rowsOf(Array(600).fill(100)).map((r) => ({ ...r, cash: 5 }));
  const dd = drawdowns(rows);
  const r = simulate(rows, dd, 252, 503, { reserve: 1, levels: [], sweepAfter: 0 });
  assert.ok(r.wealth > r.paid * 1.02 && r.wealth < r.paid * 1.06);
});

test("rollingCompare reports windows and a negative median in a steady climb", () => {
  const c = []; for (let i = 0; i < 1200; i++) c.push(100 * 1.0004 ** i);
  const out = rollingCompare(rowsOf(c), { r15: { reserve: 0.15 } }, { years: 2 });
  assert.ok(out.r15.windows > 10);
  assert.ok(out.r15.vsAllIn.median < 0);
  assert.ok(out.r15.avgCashPct > 0);
});

test("align joins total return, cash and fear by date", () => {
  const price = [{ date: "a", close: 10 }, { date: "b", close: 11 }, { date: "c", close: 12 }];
  const rows = align(price, { tr: [{ date: "a", close: 20 }, { date: "c", close: 25 }], cash: [{ date: "a", close: 4 }], vix: [{ date: "b", close: 31 }], fg: { c: 20 } });
  assert.deepEqual(rows.map((r) => r.tr), [20, 20, 25]);
  assert.deepEqual(rows.map((r) => r.cash), [4, 4, 4]);
  assert.deepEqual(rows.map((r) => r.confirm), [false, true, true]);
});

test("volProxy confirms on violent stretches only where VIX is missing", () => {
  const c = Array(60).fill(100).map((x, i) => (i > 30 ? (i % 2 ? 104 : 96) : x));
  const rows = volProxy(c.map((close, i) => ({ date: day(i), close, vix: null, confirm: false })));
  assert.equal(rows[25].confirm, false);
  assert.equal(rows[59].confirm, true);
});
