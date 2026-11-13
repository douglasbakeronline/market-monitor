import { test } from "node:test";
import assert from "node:assert/strict";
import { deepenList } from "../src/deepen.js";

const it = (symbol, score, swing = "Neutral", sector = "Industrials", swingScore = 50) =>
  ({ u: { symbol, sector }, f: {}, lt: { score }, swing: { verdict: swing, score: swingScore } });

test("focus names are deepened even when their quick score is low", () => {
  const items = [it("A", 90), it("B", 80), it("META", 40), it("C", 70)];
  const out = deepenList(items, { long: 2, swing: 0, focus: new Set(["META"]) });
  assert.deepEqual(out.map((x) => x.u.symbol).sort(), ["A", "B", "META"]);
});

test("no duplicates when a focus name is also a top candidate or a setup", () => {
  const items = [it("A", 90, "Setup", "Industrials", 70), it("B", 80)];
  const out = deepenList(items, { long: 2, swing: 2, focus: new Set(["A", "B"]) });
  assert.equal(out.length, 2);
});

test("Real Estate is always deepened; focus names missing from the scan are ignored", () => {
  const items = [it("A", 90), it("R", 10, "Neutral", "Real Estate")];
  const out = deepenList(items, { long: 1, swing: 0, focus: new Set(["ZZZ"]) });
  assert.deepEqual(out.map((x) => x.u.symbol).sort(), ["A", "R"]);
});

test("swing setups ranked by swing score; unscored long-term items skipped", () => {
  const items = [it("A", null, "Setup", "Industrials", 60), it("B", null, "Setup (earnings risk)", "Industrials", 80), it("C", null)];
  const out = deepenList(items, { long: 5, swing: 1, focus: new Set() });
  assert.deepEqual(out.map((x) => x.u.symbol), ["B"]);
});
