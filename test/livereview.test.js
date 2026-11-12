import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseShort, liveVerdict, trailOdds, tradesToTell, normCdf, testedRecord } from "../src/shortTerm.js";

const drift = { avg: 1.36, random: 0.78, edge: 0.58, sd: 12 };

test("normCdf matches known values", () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.645) - 0.95) < 1e-3);
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-3);
});

test("trailOdds and tradesToTell on the drift backtest (research log 12 Nov)", () => {
  assert.equal(trailOdds(drift), 40);
  assert.equal(trailOdds(drift, 1159), 5);
  assert.equal(tradesToTell(drift), 1159);
  assert.equal(trailOdds({ edge: 0.58 }), null, "no spread, no odds");
  assert.equal(tradesToTell({ sd: 3, edge: -0.1 }), null);
});

test("summariseShort adds spread and a 90% range from 5 closed", () => {
  const mk = (xs) => xs.map((netPct, i) => ({ kind: "drift", symbol: "S" + i, status: "closed", netPct, vsIdx: null }));
  const one = summariseShort(mk([1]));
  assert.equal(one.drift.sd, undefined);
  const s = summariseShort(mk([1, 3, -2, 4, 0]));
  assert.equal(s.drift.avg, 1.2);
  assert.equal(s.drift.sd, 2.39);
  assert.equal(s.drift.lo, -0.56);
  assert.equal(s.drift.hi, 2.96);
});

test("liveVerdict: early, behind within noise, clearly behind, clearly ahead", () => {
  const e = liveVerdict({ closed: 4 }, drift);
  assert.equal(e.stage, "early");
  assert.match(e.text, /^4 of 30 closed/);
  assert.match(e.text, /about 40% of the time/);
  assert.equal(liveVerdict({ closed: 30, avg: 0.2, lo: -3.4, hi: 3.8 }, drift).tone, "watch");
  assert.equal(liveVerdict({ closed: 30, avg: -5, lo: -8.6, hi: -1.4 }, drift).tone, "bad");
  assert.equal(liveVerdict({ closed: 30, avg: 5, lo: 1.4, hi: 8.6 }, drift).tone, "good");
  assert.equal(liveVerdict({ closed: 30, avg: 1, lo: -2.6, hi: 4.6 }, drift).tone, "neutral");
  assert.equal(liveVerdict({ closed: 0 }, { random: 0.78 }).text, "0 of 30 closed before the review.");
});

test("testedRecord carries the trade spread when the lab has it", () => {
  const lab = { results: [{ key: "drift", stop: false, signal: { n: 1, avg: 1, win: 50, vsIdx: 0, sd: 12 }, baseline: { avg: 0.5 }, edge: 0.5 }] };
  assert.equal(testedRecord(lab).drift.sd, 12);
  assert.equal(testedRecord(lab).bounce, null);
});
