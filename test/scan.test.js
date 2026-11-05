import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTable, toYahoo } from "../src/data/constituents.js";
import { quoteToFundamentals } from "../src/data/quotes.js";

test("Yahoo symbols for index tickers", () => {
  assert.equal(toYahoo("SP500", "BRK.B"), "BRK-B");
  assert.equal(toYahoo("FTSE100", "BT.A"), "BT-A.L");
  assert.equal(toYahoo("FTSE100", "RR."), "RR.L");
  assert.equal(toYahoo("FTSE100", "AZN"), "AZN.L");
});

test("constituents table parser finds the right columns", () => {
  const rows = Array.from({ length: 25 }, (_, i) => `<tr><td><a href="#">T${i}</a></td><td>Company ${i} &amp; Co</td><td>Tech</td></tr>`).join("");
  const html = `<table class="wikitable sortable"><tr><th>Symbol</th><th>Security</th><th>GICS Sector</th></tr>${rows}</table>`;
  const out = parseTable(html, { symbolCol: /symbol/i, nameCol: /security/i, sectorCol: /sector/i });
  assert.equal(out.length, 25);
  assert.deepEqual(out[3], { ticker: "T3", name: "Company 3 & Co", sector: "Tech" });
});

test("batch quote maps onto the scorer's fields", () => {
  const f = quoteToFundamentals({ forwardPE: 12.5, averageAnalystRating: "1.9 - Buy", trailingAnnualDividendYield: 0.04, earningsTimestamp: Date.now() / 1000 + 86400 * 3 });
  assert.equal(f.forwardPE, 12.5);
  assert.equal(f.recommendationMean, 1.9);
  assert.equal(f.dividendYield, 0.04);
  assert.ok(f.nextEarnings);
});

test("quote earnings timestamp in the past becomes lastEarnings, not nextEarnings", () => {
  const f = quoteToFundamentals({ earningsTimestamp: Date.parse("2026-10-27T06:00:00Z") / 1000 });
  assert.equal(f.nextEarnings, null);
  assert.equal(f.lastEarnings, "2026-10-27");
  const g = quoteToFundamentals({ earningsTimestamp: Date.now() / 1000 + 86400 * 3 });
  assert.equal(g.lastEarnings, null);
});

import { sessionsBehind as sb } from "../src/research.js";
test("sessionsBehind counts weekday sessions only", () => {
  assert.equal(sb("2026-11-03", "2026-11-03"), 0);
  assert.equal(sb("2026-11-02", "2026-11-03"), 1);
  assert.equal(sb("2026-10-30", "2026-11-02"), 1, "Fri to Mon is one session");
  assert.equal(sb("2026-10-30", "2026-11-04"), 3, "Kenvue case: stale");
  assert.equal(sb(null, "2026-11-04"), 0);
});

test("quote dividend yield is rescaled for pence-quoted London stocks", () => {
  assert.equal(quoteToFundamentals({ currency: "GBp", trailingAnnualDividendYield: 0.000434 }).dividendYield.toFixed(4), "0.0434");
  assert.equal(quoteToFundamentals({ currency: "USD", trailingAnnualDividendYield: 0.02 }).dividendYield, 0.02);
  assert.equal(quoteToFundamentals({ currency: "GBp" }).dividendYield, null);
});

test("a results date already past moves to lastEarnings (no '-1 days')", async () => {
  const { earningsFields } = await import("../src/research.js");
  assert.deepEqual(earningsFields("2026-11-04", null, "2026-11-05"), { earnings: null, lastEarnings: "2026-11-04" });
  assert.deepEqual(earningsFields("2026-11-04", "2026-08-05", "2026-11-05"), { earnings: null, lastEarnings: "2026-11-04" });
  assert.deepEqual(earningsFields("2026-11-05", "2026-08-05", "2026-11-05"), { earnings: { date: "2026-11-05", days: 0 }, lastEarnings: "2026-08-05" });
  assert.deepEqual(earningsFields("2026-11-12", "2026-08-05", "2026-11-05"), { earnings: { date: "2026-11-12", days: 7 }, lastEarnings: "2026-08-05" });
  assert.deepEqual(earningsFields(null, "2026-10-22", "2026-11-05"), { earnings: null, lastEarnings: "2026-10-22" });
  assert.deepEqual(earningsFields(null, null, "2026-11-05"), { earnings: null, lastEarnings: null });
});
