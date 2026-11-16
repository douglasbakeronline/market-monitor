import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHoldingsPage, toCoreHoldings } from "../src/coreHoldings.js";

// Shape of stockanalysis.com's VWRP holdings page (checked on the runner 16 Nov 2026).
const page = `<script>data:[{no:1,s:"$NVDA",n:"NVIDIA Corporation",holdingWeight:5.03,holdingShares:1},` +
  `{no:2,s:"$GOOGL",n:"Alphabet Inc.",holdingWeight:1.92,holdingShares:1},` +
  `{no:3,s:"@TPE-2330",n:"Taiwan Semiconductor Manufacturing Company Limited",holdingWeight:1.79},` +
  `{no:4,s:"$GOOG",n:"Alphabet Inc.",holdingWeight:1.5},` +
  `{no:5,s:"$TSLA",n:"Tesla, Inc.",holdingWeight:.98},` +
  `{no:6,s:"@KRX-005930",n:"Samsung Electronics Co., Ltd.",holdingWeight:.87},` +
  `{no:7,s:"$BRK.B",n:"Berkshire Hathaway Inc.",holdingWeight:.71},` +
  `{no:8,s:"@AMS-ASML",n:"ASML Holding N.V.",holdingWeight:.66},` +
  `{no:9,s:"@XYZ-1",n:"Unknown Listing",holdingWeight:.5}],x:1,date:"Sep 30, 2026",count:3818}</script>`;

test("parses the holdings rows and the as-of date", () => {
  const p = parseHoldingsPage(page);
  assert.equal(p.date, "Sep 30, 2026");
  assert.equal(p.count, 3818);
  assert.equal(p.rows.length, 9);
  assert.deepEqual(p.rows[4], { symbol: "$TSLA", name: "Tesla, Inc.", weight: 0.98 });
});

test("maps to Yahoo symbols, merges share classes, keeps the plan's names and extras", () => {
  const out = toCoreHoldings(parseHoldingsPage(page).rows);
  assert.deepEqual(out.map((h) => h.symbol), ["NVDA", "GOOGL", "TSM", "TSLA", "005930.KS", "BRK-B", "ASML.AS"]);
  assert.equal(out[1].weight, 3.42); // GOOGL + GOOG
  assert.equal(out[1].name, "Alphabet");
  assert.equal(out[2].extra, true); // TSMC via its US listing, an extra quote in the scan
  assert.equal(out[4].extra, true);
  assert.equal(out[3].extra, undefined);
  assert.equal(out[0].name, "Nvidia");
});

test("an unmapped foreign listing is reported, not guessed", () => {
  const out = toCoreHoldings(parseHoldingsPage(page).rows);
  assert.deepEqual(out.unmapped, ["@XYZ-1 Unknown Listing"]);
});

test("a page without the data block gives no rows", () => {
  assert.deepEqual(parseHoldingsPage("<html>blocked</html>").rows, []);
});
