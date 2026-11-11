import { test } from "node:test";
import assert from "node:assert/strict";
import { reitLongTerm, longTermLive } from "../src/research.js";
import { withReitScore } from "../src/sectorValue.js";
import { pickStatus } from "../src/plan.js";

const f = { sector: "Real Estate", industry: "REIT - Diversified", forwardPE: 8.4, trailingPE: 8.4, peg: 0.9, profitMargin: 0.5, roe: 0.1, revenueGrowth: 0.04, earningsGrowth: 0.05, debtToEquity: 60, evToEbitda: 14 };
const t = { last: 30, rsi: 45, offHigh: -5, vs200: 1, vs50: -1, rangePos: 0.5, mom12_1: 5 };
const peer = { sector: "Real Estate", region: "US", n: 29, pe: 36, forwardPE: 36, trailingPE: 36, evToEbitda: 19, cyclical: false };

test("reitLongTerm: P/OCF against the REIT median replaces P/E in Value", () => {
  const live = longTermLive(f, t, peer);
  const cheapOnPe = live.pillars.find((p) => p.key === "value").score;
  const r = reitLongTerm(f, t, peer, { pocf: 10.2, median: 14.3 });
  assert.ok(r && r.score != null);
  assert.ok(r.value < cheapOnPe, "29% below the REIT median is less cheap than 77% below on P/E");
  const dear = reitLongTerm(f, t, peer, { pocf: 25, median: 14.3 });
  assert.ok(dear.value < r.value, "dearer on cash flow scores lower");
});

test("reitLongTerm: null without a view or a median", () => {
  assert.equal(reitLongTerm(f, t, peer, null), null);
  assert.equal(reitLongTerm(f, t, peer, { pocf: 10, median: null }), null);
  assert.equal(reitLongTerm(f, t, null, { pocf: 10, median: 14 }), null);
});

test("withReitScore adds the score and one sentence", () => {
  const sv = withReitScore({ note: "P/E note." }, { score: 70, verdict: "Fair", value: 80, gaps: [] });
  assert.equal(sv.reit.verdict, "Fair");
  assert.match(sv.note, /On cash flow instead of P\/E: Value 80, score 70 \(Fair\)/);
  assert.equal(withReitScore(null, {}), null);
});

test("pickStatus: reitOk follows the REIT verdict and the results rule; null for non-REITs", () => {
  const pick = { symbol: "VICI", name: "VICI" };
  const base = { longTerm: { verdict: "Fair", score: 69 }, earnings: { days: 40 } };
  const a = pickStatus(pick, { ...base, sectorValue: { reit: { verdict: "Good entry", score: 74 } } }, "2026-11-11");
  assert.equal(a.ok, false);
  assert.equal(a.reitOk, true);
  assert.equal(a.reitVerdict, "Good entry");
  const b = pickStatus(pick, { ...base, earnings: { days: 3 }, sectorValue: { reit: { verdict: "Good entry", score: 74 } } }, "2026-11-11");
  assert.equal(b.reitOk, false, "results in 3 days");
  assert.equal(pickStatus({ symbol: "META" }, base, "2026-11-11").reitOk, null);
});
