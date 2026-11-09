import { test } from "node:test";
import assert from "node:assert/strict";
import { longTerm, isInvestmentTrust } from "../src/research.js";

// PCT on 3 Nov 2026: forward P/E 1.8 from portfolio gains topped the scan at 96.
const trustLike = { forwardPE: 1.8, trailingPE: 2.1, profitMargin: 0.9, roe: 0.4, revenueGrowth: 0.5, earningsGrowth: 0.6, debtToEquity: 5 };
const tech = { last: 100, offHigh: -20, vs200: -2, rsi: 35, sma50: 101, sma200: 99 };

test("investment trusts are detected from the FTSE sector, Yahoo sector or name", () => {
  assert.ok(isInvestmentTrust({ closedEnd: true }));
  assert.ok(isInvestmentTrust({ sector: "Closed End Investments" }));
  assert.ok(isInvestmentTrust({ name: "Scottish Mortgage Investment Trust PLC" }));
  assert.equal(isInvestmentTrust({ sector: "Financial Services", name: "Lloyds Banking Group plc" }), false);
  assert.equal(isInvestmentTrust({ sector: "Real Estate", name: "Federal Realty Investment Trust" }), false, "a US REIT is a company");
  assert.equal(isInvestmentTrust(null), false);
});

test("an investment trust is not scored, so it cannot be a Good entry", () => {
  const plain = longTerm(trustLike, tech);
  assert.ok(plain.score >= 72, `same numbers as a company score high (${plain.score})`);
  const lt = longTerm({ ...trustLike, closedEnd: true }, tech);
  assert.equal(lt.score, null);
  assert.equal(lt.verdict, "Investment trust");
  assert.match(lt.note, /net asset value/);
  assert.ok(lt.pillars.length, "pillars kept for display");
  assert.ok(lt.pillars.every((p) => p.score == null), "no pillar scores, so no false strengths");
});

test("a bitcoin holding company (Strategy) is not scored, and stays out of peer medians", async () => {
  const { assetHolding, notScored } = await import("../src/research.js");
  assert.equal(assetHolding({ name: "Strategy Inc" }), "bitcoin");
  assert.equal(assetHolding({ name: "MicroStrategy Incorporated" }), "bitcoin");
  assert.equal(assetHolding({ name: "Strategic Education, Inc." }), null, "a similar name is a company");
  assert.equal(assetHolding({ name: "Regency Centers" }), null);
  assert.ok(notScored({ name: "Strategy Inc" }) && notScored({ closedEnd: true }) && !notScored({ name: "Apple Inc." }));
  const lt = longTerm({ ...trustLike, name: "Strategy Inc" }, tech);
  assert.equal(lt.score, null);
  assert.equal(lt.verdict, "Holding company");
  assert.match(lt.note, /bitcoin/);
  assert.ok(lt.trust && lt.pillars.every((p) => p.score == null));
});
