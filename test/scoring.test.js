import { test } from "node:test";
import assert from "node:assert/strict";
import { longTerm, longTermLive, ruleChangeNote, SCORING_VERSION } from "../src/research.js";
import { scoreChange } from "../src/stockHistory.js";

const f = { forwardPE: 14, trailingPE: 16, peg: 1.1, profitMargin: 0.2, roe: 0.2, revenueGrowth: 0.1, earningsGrowth: 0.12, debtToEquity: 50, targetMean: 120, recommendationMean: 2, sector: "Industrials" };
const t = (offHigh, mom12_1) => ({ last: 100, offHigh, vs200: -2, rsi: 45, sma50: 101, sma200: 99, mom12_1 });

test("longTermLive is peer value plus the 10 Nov Entry rule", () => {
  const peer = { forwardPE: 20, trailingPE: 22, evToEbitda: 12, cyclical: false };
  const live = longTermLive(f, t(-25, 30), peer);
  assert.deepEqual(live, longTerm(f, t(-25, 30), peer, { entryAlt: true }));
  const entry = live.pillars.find((p) => p.key === "entry");
  assert.ok(entry.items.some((i) => i.key === "mom"), "momentum in Entry");
  assert.match(entry.items[0].why, /no extra credit/);
  assert.match(live.pillars.find((p) => p.key === "value").items[0].display, /sector 20\.0/);
  assert.equal(SCORING_VERSION, "2026-11-10");
});

test("ruleChangeNote only when the verdict moved", () => {
  const live = { score: 80, verdict: "Good entry" }, old = { score: 70, verdict: "Fair" };
  const n = ruleChangeNote(old, live);
  assert.deepEqual([n.verdict, n.score], ["Fair", 70]);
  assert.match(n.note, /Good entry now, Fair \(70\) under the old rule\.$/);
  assert.equal(ruleChangeNote({ score: 75, verdict: "Fair" }, { score: 70, verdict: "Fair" }), null);
  assert.equal(ruleChangeNote(old, { ...live, trust: true }), null);
  assert.equal(ruleChangeNote(null, live), null);
});

test("scoreChange leaves out long-term changes measured across the rule change", () => {
  const pts = [["2026-11-03", 70, 50], ["2026-11-10", 82, 55], ["2026-11-17", 84, 60]];
  assert.deepEqual(scoreChange(pts.slice(0, 2), "2026-11-12", 7, { ltFrom: "2026-11-10" }), { lt: null, sw: 5, since: "2026-11-03" });
  assert.equal(scoreChange(pts, "2026-11-17", 7, { ltFrom: "2026-11-10" }).lt, 2);
  assert.equal(scoreChange(pts.slice(0, 2), "2026-11-12", 7).lt, 12, "without ltFrom as before");
});
