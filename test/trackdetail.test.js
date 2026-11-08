import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, homeIndex, marketOfSymbol, byMarket, byScore, byHorizon, scoreOf, digestKindLine, byKind, MIN_PER_KIND } from "../src/trackRecord.js";

const days = (n, start = 100, step = 1) => Array.from({ length: n }, (_, i) => ({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, close: start + i * step }));

test("homeIndex and market by symbol", () => {
  assert.equal(homeIndex("HSBA.L"), "^FTSE");
  assert.equal(homeIndex("SAP.DE"), "^STOXX50E");
  assert.equal(homeIndex("META"), "^GSPC");
  assert.equal(marketOfSymbol("^GSPC"), "IDX");
  assert.equal(marketOfSymbol("ASML.AS"), "EU");
  assert.equal(marketOfSymbol("LLOY.L"), "UK");
});

test("evaluate compares UK names with the FTSE and US names with the S&P", () => {
  const sp = days(70, 100, 1);      // S&P rises 1 a day
  const ftse = days(70, 100, 0);    // FTSE flat
  const stock = days(70, 100, 0.5);
  const log = [
    { id: "a", kind: "research-lt", symbol: "HSBA.L", date: sp[0].date, price: 100 },
    { id: "b", kind: "research-lt", symbol: "META", date: sp[0].date, price: 100 },
    { id: "c", kind: "buy", symbol: "^GSPC", date: sp[0].date, price: 100 },
    { id: "d", kind: "research-lt", symbol: "SAP.DE", date: sp[0].date, price: 100 },
  ];
  const out = evaluate(log, { "HSBA.L": stock, META: stock, "^GSPC": sp, "^FTSE": ftse, "SAP.DE": stock }, sp);
  const [uk, us, idx, eu] = out;
  assert.equal(uk.perf.idx, "^FTSE");
  assert.equal(uk.perf.idxNow, 0);
  assert.equal(uk.perf.vsIdx, uk.perf.now);
  assert.equal(uk.perf.m1Idx, 0);
  assert.equal(us.perf.idx, "^GSPC");
  assert.equal(us.perf.vsIdx, us.perf.vsSp);
  assert.equal(us.perf.m1Idx, us.perf.m1Sp);
  assert.equal(idx.perf.idx, undefined, "an index signal is not compared with itself");
  assert.equal(eu.perf.idx, "^GSPC", "falls back to the S&P without Euro Stoxx rows");
});

const sig = (symbol, kind, label, perf) => ({ symbol, kind, label, date: "2026-11-01", perf: { sessions: 30, ...perf } });

test("byMarket groups and holds rates back until enough are scored", () => {
  const log = [
    ...Array.from({ length: MIN_PER_KIND }, (_, i) => sig("LLOY.L", "research-lt", "Good entry (82)", { now: i < 4 ? 3 : -2, idxNow: 1 })),
    sig("META", "research-swing", "Swing setup (71)", { now: 2, idxNow: 1 }),
  ];
  const g = byMarket(log);
  const uk = g.find((x) => x.market === "UK");
  assert.equal(uk.total, MIN_PER_KIND);
  assert.equal(uk.hitRate, 80);
  assert.equal(uk.beatIdx, 80);
  assert.equal(uk.avgVsIdx, 1);
  assert.equal(uk.basis, "now");
  const us = g.find((x) => x.market === "US");
  assert.equal(us.enough, false);
  assert.equal(us.hitRate, null);
});

test("byMarket switches to one month once three signals have it", () => {
  const log = Array.from({ length: 6 }, (_, i) => sig("META", "research-lt", "", { now: 1, idxNow: 0, m1: i < 3 ? 5 : null, m1Idx: i < 3 ? 1 : null }));
  const [us] = byMarket(log);
  assert.equal(us.basis, "m1");
  assert.equal(us.scored, 3);
  assert.equal(us.enough, false);
});

test("scoreOf reads the score from the label; byScore bands", () => {
  assert.equal(scoreOf({ label: "Swing setup (78)" }), 78);
  assert.equal(scoreOf({ label: "Buy tier -10%" }), null);
  const log = [sig("A", "research-swing", "Swing setup (85)", { now: 1 }), sig("B", "research-swing", "Swing setup (72)", { now: -1 }), sig("C", "research-swing", "Swing setup (70)", { now: 1 }), sig("^GSPC", "buy", "Buy tier", { now: 1 })];
  const b = byScore(log);
  assert.deepEqual(b.map((x) => [x.band, x.total]), [["80+", 1], ["70 to 79", 2]]);
});

test("byHorizon gives week, month and quarter side by side", () => {
  const log = Array.from({ length: MIN_PER_KIND }, (_, i) => sig("^GSPC", "greed", "Greed", { w1: i ? -1 : 1, m1: -2 }));
  const [g] = byHorizon(log);
  assert.equal(g.label, "Greed: stop adding");
  assert.deepEqual(g.horizons.map((h) => h.key), ["w1", "m1", "m3"]);
  assert.equal(g.horizons[0].hitRate, 80, "for greed a fall is right");
  assert.equal(g.horizons[0].avgReturn, -0.6);
  assert.equal(g.horizons[1].hitRate, 100);
  assert.equal(g.horizons[2].scored, 0);
  assert.equal(g.horizons[2].hitRate, null);
});

test("digestKindLine", () => {
  assert.equal(digestKindLine([]), null);
  const early = byKind([sig("A", "research-swing", "", { now: 1, vsSp: 1 }), sig("B", "research-lt", "", { now: 1, vsSp: 1 }), sig("C", "research-lt", "", { now: 1, vsSp: 1 })]);
  assert.match(digestKindLine(early), /too early for all 2 .*closest: Long-term good entry, 2 of 5/);
  const ready = byKind([...Array.from({ length: 5 }, () => sig("A", "research-swing", "", { now: 2, vsSp: 1.5 })), sig("B", "research-lt", "", { now: 1, vsSp: 1 })]);
  assert.equal(digestKindLine(ready), "By type: Swing setup 100% right so far, avg +1.5% vs S&P (5); 1 other type too early.");
});
