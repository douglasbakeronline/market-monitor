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
