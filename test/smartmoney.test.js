import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInfoTable, aggregate, diff, figiTicker, byTicker, smartTag, toYahoo } from "../src/smartMoney.js";

const XML = `<?xml version="1.0"?><ns1:informationTable xmlns:ns1="x">
<ns1:infoTable><ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:cusip>037833100</ns1:cusip><ns1:value>600</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>100</ns1:sshPrnamt></ns1:shrsOrPrnAmt></ns1:infoTable>
<ns1:infoTable><ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:cusip>037833100</ns1:cusip><ns1:value>200</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>30</ns1:sshPrnamt></ns1:shrsOrPrnAmt></ns1:infoTable>
<ns1:infoTable><ns1:nameOfIssuer>COCA COLA CO</ns1:nameOfIssuer><ns1:cusip>191216100</ns1:cusip><ns1:value>200</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>50</ns1:sshPrnamt></ns1:shrsOrPrnAmt></ns1:infoTable>
<ns1:infoTable><ns1:nameOfIssuer>SPDR PUT</ns1:nameOfIssuer><ns1:cusip>78462F103</ns1:cusip><ns1:value>999</ns1:value><ns1:putCall>Put</ns1:putCall><ns1:shrsOrPrnAmt><ns1:sshPrnamt>1</ns1:sshPrnamt></ns1:shrsOrPrnAmt></ns1:infoTable>
</ns1:informationTable>`;

test("parses a namespaced 13F table, skips options, merges and weights", () => {
  const rows = parseInfoTable(XML);
  assert.equal(rows.length, 3);
  const agg = aggregate(rows);
  assert.equal(agg.length, 2);
  assert.deepEqual(agg.map((x) => [x.cusip, x.shares, x.weight]), [["037833100", 130, 80], ["191216100", 50, 20]]);
  assert.equal(parseInfoTable(XML.replace(/ns1:/g, "")).length, 3, "un-prefixed tags too");
});

test("quarter-on-quarter changes", () => {
  const prev = [{ cusip: "A", shares: 100, name: "A" }, { cusip: "B", shares: 100, name: "B" }, { cusip: "C", shares: 100, name: "C" }, { cusip: "D", shares: 100, name: "D" }];
  const cur = [{ cusip: "A", shares: 120, weight: 40 }, { cusip: "B", shares: 50, weight: 30 }, { cusip: "C", shares: 105, weight: 20 }, { cusip: "E", shares: 10, weight: 10 }];
  const { holdings, sold } = diff(cur, prev);
  assert.deepEqual(holdings.map((h) => h.change), ["added", "trimmed", "held", "new"]);
  assert.deepEqual(sold.map((s) => s.cusip), ["D"]);
  assert.equal(diff(cur, null).holdings[3].change, "held", "no previous filing: no false 'new'");
});

test("OpenFIGI ticker pick and Yahoo share-class format", () => {
  assert.equal(figiTicker({ data: [{ ticker: "BRK/B", exchCode: "UN", securityType: "Common Stock" }, { ticker: "BRK/B", exchCode: "US", securityType: "Common Stock" }] }), "BRK.B");
  assert.equal(toYahoo("BRK.B"), "BRK-B");
  assert.equal(figiTicker({ error: "No identifier found." }), null);
});

test("ticker tags", () => {
  const managers = [
    { name: "Akre Capital", holdings: [{ cusip: "X", weight: 5, change: "held" }], sold: [{ cusip: "Z" }] },
    { name: "Berkshire Hathaway", holdings: [{ cusip: "X", weight: 9, change: "new" }], sold: [] },
  ];
  const t = byTicker(managers, { X: "MA", Z: "BRK.B" });
  assert.equal(smartTag(t.MA), "Held by Berkshire Hathaway (new), Akre Capital");
  assert.equal(smartTag(t["BRK-B"]), null, "sold only: no tag");
});
