import { test } from "node:test";
import assert from "node:assert/strict";
import { reitLongTerm, longTermLive, longTermScored, SCORING_VERSION } from "../src/research.js";
import { withReitScore, sectorValueNote } from "../src/sectorValue.js";
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

test("withReitScore keeps the cash-flow score and says what P/E would have given", () => {
  const sv = withReitScore({ note: "Cash-flow note." }, { score: 70, verdict: "Fair", value: 80, gaps: [] }, { score: 74, verdict: "Good entry", value: 95 });
  assert.equal(sv.reit.verdict, "Fair");
  assert.match(sv.note, /On P\/E instead it would be Value 95, score 74 \(Good entry\)\.$/);
  assert.equal(withReitScore({ note: "x" }, { score: 70 }).note, "x", "no P/E line without a P/E score");
  assert.equal(withReitScore(null, {}), null);
  const full = withReitScore({ note: "n" }, { score: 70 }, longTermLive(f, t, peer));
  assert.equal(full.reitPe.value, longTermLive(f, t, peer).pillars.find((p) => p.key === "value").score, "reads Value from a full score");
});

test("longTermScored: a REIT with a cash-flow view is scored on it (live since 12 Nov)", () => {
  const rv = { pocf: 10.2, median: 14.3, n: 21 };
  const lt = longTermScored(f, t, peer, rv);
  const r = reitLongTerm(f, t, peer, rv);
  assert.equal(lt.score, r.score, "same score as the paper view it replaces");
  assert.equal(lt.verdict, r.verdict);
  assert.deepEqual(lt.reit, { pocf: 10.2, median: 14.3, n: 21 });
  const items = lt.pillars.find((p) => p.key === "value").items;
  assert.ok(items.some((i) => i.key === "pocf" && /Price \/ cash flow/.test(i.label) && i.display === "10.2× (REITs 14.3×)"));
  assert.ok(!items.some((i) => /P\/E$/.test(i.label)), "no item still labelled as a P/E");
  assert.notEqual(lt.score, longTermLive(f, t, peer).score, "differs from the P/E score here");
  assert.equal(SCORING_VERSION, "2026-11-12");
});

test("longTermScored: falls back to the P/E score without a view, a median or peers", () => {
  const live = longTermLive(f, t, peer);
  assert.deepEqual(longTermScored(f, t, peer, null), live);
  assert.deepEqual(longTermScored(f, t, peer, { pocf: 10, median: null }), live);
  assert.equal(longTermScored(f, t, peer, null).reit, undefined);
  const meta = { sector: "Technology", forwardPE: 20, trailingPE: 22 };
  assert.deepEqual(longTermScored(meta, t, null, null), longTermLive(meta, t, null));
});

test("sectorValueNote: a REIT scored on cash flow says so; P/E marked as not used", () => {
  const rv = { pocf: 10.2, median: 14.3, n: 21, note: "Price / operating cash flow 10.2×, a rough stand-in for P/FFO, 29% below the median of 21 fully scored REITs (14.3×)." };
  const lt = longTermScored(f, t, peer, rv);
  const sv = sectorValueNote(f, peer, longTermLive(f, t, null), lt, rv);
  assert.match(sv.note, /Scored on cash flow \(since 12 Nov\): Price \/ operating cash flow 10\.2×/);
  assert.match(sv.note, /\(not used for REITs\)/);
  const noMed = sectorValueNote(f, peer, longTermLive(f, t, null), longTermLive(f, t, peer), { ...rv, median: null, note: "Price / operating cash flow 10.2×, a rough stand-in for P/FFO." });
  assert.match(noMed.note, /REIT view \(not in the score yet: too few fully scored REITs for a median\)/);
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

test("ruleChangeNote mentions the REIT change only for REITs scored on cash flow", async () => {
  const { ruleChangeNote, longTerm } = await import("../src/research.js");
  const old = { score: 60, verdict: "Fair" };
  assert.match(ruleChangeNote(old, { score: 75, verdict: "Good entry", reit: { pocf: 10 } }).note, /REITs are valued on cash flow/);
  assert.doesNotMatch(ruleChangeNote(old, { score: 75, verdict: "Good entry" }).note, /REIT/);
});

test("withReitHint: a UK REIT with no industry from Yahoo is recognised by its listed FTSE sector", async () => {
  const { withReitHint, pocf } = await import("../src/sectorValue.js");
  const bbox = { sector: "Real Estate", industry: null, marketCap: 4e9, operatingCashflow: 2.5e8 };
  assert.equal(pocf(bbox), null, "no industry: not seen as a REIT");
  assert.equal(pocf(withReitHint(bbox, "Real Estate Investment Trusts")), 16);
  assert.equal(withReitHint(bbox, "Real Estate Investment & Services"), bbox, "property services stay as they are");
  const named = { sector: "Real Estate", industry: "Real Estate Services" };
  assert.equal(withReitHint(named, "Real Estate Investment Trusts"), named, "an industry from Yahoo wins");
  assert.equal(withReitHint(null, "Real Estate Investment Trusts"), null);
});
