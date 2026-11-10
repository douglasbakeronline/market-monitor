import { test } from "node:test";
import assert from "node:assert/strict";
import { prepare, sellSignalsAt, latestSellSignals, summariseSell } from "../src/sellSignals.js";

const rowsOf = (closes) => closes.map((close, i) => ({ date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), close, high: close * 1.005, low: close * 0.995 }));

test("trend break: first close below the 200-day after a month above", () => {
  const c = [...Array.from({ length: 260 }, (_, i) => 100 + i * 0.2), 120];
  const p = prepare(rowsOf(c));
  assert.ok(sellSignalsAt(p, c.length - 1).includes("trendBreak"));
  assert.ok(!sellSignalsAt(p, c.length - 2).includes("trendBreak"));
});

test("big fall and trailing stop", () => {
  const c = [...Array.from({ length: 120 }, (_, i) => 100 + i * 0.1), 100];
  const p = prepare(rowsOf(c));
  const s = sellSignalsAt(p, c.length - 1);
  assert.ok(s.includes("bigFall"));
  assert.ok(s.includes("trailStop"));
  const live = latestSellSignals(rowsOf(c));
  assert.ok(live.signals.some((x) => x.kind === "bigFall" && /8%/.test(x.label)));
  assert.ok(live.stop > 100);
  assert.deepEqual(latestSellSignals(rowsOf([1, 2, 3])), { signals: [], stop: null });
});

test("overbought fires once on the way up", () => {
  const c = [...Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 1 : -1)), ...Array.from({ length: 15 }, (_, i) => 101 + (i + 1) * 2)];
  const p = prepare(rowsOf(c));
  const hits = c.map((_, i) => sellSignalsAt(p, i).includes("overbought")).filter(Boolean).length;
  assert.equal(hits, 1);
});

test("summariseSell compares with the average day and gives a verdict", () => {
  const base = Array.from({ length: 1000 }, (_, i) => ({ d5: 0.2, d21: 0.5 + (i % 2 ? 1 : -1), d63: 1 }));
  const ev = Array.from({ length: 200 }, (_, i) => ({ kind: "bigFall", d5: -1, d21: -2 + (i % 2 ? 0.5 : -0.5), d63: -1 }));
  const s = summariseSell(ev, base);
  assert.equal(s.base.d21, 0.5);
  assert.equal(s.byKind.bigFall.d21.vsAverage, -2.5);
  assert.equal(s.byKind.bigFall.verdict, "useful");
  assert.equal(s.byKind.overbought.verdict, "too few");
});
