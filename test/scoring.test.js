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
  assert.equal(SCORING_VERSION, "2026-11-12");
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

test("goodEntryGaps names what keeps a stock short of Good entry", async () => {
  const { goodEntryGaps } = await import("../src/research.js");
  const get = (m) => (k) => m[k];
  assert.deepEqual(goodEntryGaps(77, get({ entry: 69, quality: 94, value: 64 })), ["Entry 69, needs 70"]);
  assert.deepEqual(goodEntryGaps(68, get({ entry: 75, quality: 50, value: 40 })), ["score 68, needs 72", "Quality 50, needs 55", "Value 40, needs 45"]);
  assert.deepEqual(goodEntryGaps(80, get({ entry: 75, quality: 80, value: 60 }), true), ["trend still down (below the 50-day, which is below the 200-day)"]);
  assert.deepEqual(goodEntryGaps(80, get({ quality: 80, value: 60 })), ["no Entry data"]);
  const lt = longTermLive(f, t(-1, 5));
  assert.equal(lt.verdict === "Good entry" ? lt.gaps.length : 1, 1);
});

test("pick tranche check says why a pick is not a good entry", async () => {
  const { pickStatus } = await import("../src/plan.js");
  const st = pickStatus({ symbol: "META" }, { ticker: "META", longTerm: { verdict: "Fair", score: 77, gaps: ["Entry 69, needs 70"] }, earnings: { date: "2027-01-28", days: 79 } }, "2026-11-10");
  assert.equal(st.reason, "Not a good entry today (Entry 69, needs 70): hold off this tranche.");
});

test("freshSignal: a verdict flickering back within 10 days is not a new signal", async () => {
  const { freshSignal } = await import("../src/research.js");
  assert.equal(freshSignal(true, false, null, "2026-11-10"), true);
  assert.equal(freshSignal(true, true, "2026-11-09", "2026-11-10"), false, "still on");
  assert.equal(freshSignal(true, false, "2026-11-05", "2026-11-10"), false, "back after 5 days");
  assert.equal(freshSignal(true, false, "2026-10-25", "2026-11-10"), true, "back after 16 days");
  assert.equal(freshSignal(false, false, null, "2026-11-10"), false);
});

test("nearGood: one bar missed by 3 points or less, trend not down", async () => {
  const { nearGood } = await import("../src/research.js");
  const get = (m) => (k) => m[k];
  assert.equal(nearGood(77, get({ entry: 69, quality: 94, value: 64 })), true);
  assert.equal(nearGood(77, get({ entry: 66, quality: 94, value: 64 })), false, "4 short");
  assert.equal(nearGood(71, get({ entry: 69, quality: 94, value: 64 })), false, "two bars missed");
  assert.equal(nearGood(77, get({ entry: 69, quality: 94, value: 64 }), true), false, "falling");
});
