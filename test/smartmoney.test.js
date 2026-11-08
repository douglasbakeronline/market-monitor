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

import { parse13fInfoFilings, parse13fInfoData } from "../src/smartMoney.js";

const row = (acc, period, filed, form, q) => `<tr class="x"> <td class="px-3" data-order="${period}"> <a href="/13f/${acc}-berkshire-hathaway-inc-${q}">${q}</a> </td> <td>29</td> <td data-order="299253556.2"> 299,253,556 </td> <td title="AAPL, AXP">AAPL, AXP</td> <td class="px-3 truncate" title="${form}"> ${form} </td> <td class="px-3 text-right" data-order="${filed}">x</td> <td>${acc}</td> </tr>`;

test("parse13fInfoFilings keeps original 13F-HR filings, newest period first", () => {
  const html = `<h1>Berkshire</h1><table><tbody>${[
    row("000119312526226661", "2026-03-31", "2026-05-15", "13F-HR", "q1-2026"),
    row("000119312526352200", "2026-06-30", "2026-08-14", "13F-HR", "q2-2026"),
    row("000119312526399999", "2026-06-30", "2026-09-01", "13F-HR/A", "q2-2026"),
    row("000119312525282901", "2025-09-30", "2025-11-14", "13F-NT", "q3-2025"),
  ].join("")}</tbody></table>`;
  const f = parse13fInfoFilings(html);
  assert.deepEqual(f.map((x) => x.acc), ["000119312526352200", "000119312526226661"]);
  assert.equal(f[0].period, "2026-06-30");
  assert.equal(f[0].filed, "2026-08-14");
  assert.deepEqual(parse13fInfoFilings(""), []);
});

test("parse13fInfoData maps rows and tickers and drops options", () => {
  const { rows, tickers } = parse13fInfoData({ data: [
    ["AAPL", "APPLE INC", "COM", "037833100", 65950296, 22.0, 227917808, null, null],
    ["BRK.B", "BERKSHIRE HATHAWAY INC DEL", "CL B NEW", "084670702", 100, 0.1, 5, null, null],
    ["SPY", "SPDR S&P 500 ETF", "TR UNIT", "78462F103", 500, 0.2, 10, null, "Put"],
    ["X", "BAD", "COM", "", 1, 0, 1, null, null],
  ] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: "APPLE INC", cusip: "037833100", value: 65950296, shares: 227917808 });
  assert.deepEqual(tickers, { "037833100": "AAPL", "084670702": "BRK.B" });
  assert.deepEqual(parse13fInfoData(null), { rows: [], tickers: {} });
});

import { smartFor, quarterLabel } from "../src/smartMoney.js";

test("smartFor builds a display-only tag from data/smart-money.json", () => {
  const sm = {
    managers: [{ name: "Akre Capital", period: "2026-06-30" }, { name: "Fundsmith", period: "2026-06-30" }, { name: "Pershing Square", period: "2026-03-31" }],
    byTicker: {
      MA: [{ manager: "Akre Capital", weight: 20, change: "trimmed" }, { manager: "Fundsmith", weight: 3, change: "added" }, { manager: "Pershing Square", weight: 0.4, change: "new" }],
      JNJ: [{ manager: "Fundsmith", weight: 0.5, change: "held" }],
      NKE: [{ manager: "Pershing Square", weight: 0, change: "sold" }],
    },
  };
  const ma = smartFor("MA", sm);
  assert.equal(ma.tag, "Held by Akre Capital, Fundsmith (added)");
  assert.equal(ma.managers, 2);
  assert.equal(ma.asOf, "Q2 2026");
  assert.equal(ma.note, "Held by Akre Capital, Fundsmith (added). From Q2 2026 13F filings (positions of 1% or more), published up to 45 days after each quarter. Tested since 2022: their new or added positions did not beat the market once filed.");
  assert.equal(smartFor("JNJ", sm), null, "a position under 1% is not a tag");
  const both = smartFor("MA", { ...sm, byTicker: { MA: [...sm.byTicker.MA, { manager: "Pershing Square", weight: 5, change: "held" }] } });
  assert.equal(both.asOf, "Q1 2026 to Q2 2026");
  const nke = smartFor("NKE", sm);
  assert.equal(nke.tag, null);
  assert.deepEqual(nke.sold, ["Pershing Square"]);
  assert.equal(nke.asOf, "Q1 2026");
  assert.match(nke.note, /^Sold out by Pershing Square\. From Q1 2026/);
  assert.equal(smartFor("AAPL", sm), null);
  assert.equal(smartFor("MA", null), null);
  assert.equal(quarterLabel("2025-12-31"), "Q4 2025");
});

import { smartEvent } from "../src/smartMoney.js";

test("smartEvent fires once on a new or added position, never on first sight", () => {
  const q2 = { asOf: "Q2 2026", tag: "Held by Fundsmith (added), Akre Capital" };
  const first = smartEvent(undefined, q2);
  assert.equal(first.fire, false, "no memory yet: recorded silently");
  assert.equal(first.key, "Q2 2026|Held by Fundsmith (added), Akre Capital");
  assert.equal(smartEvent(first.key, q2).fire, false, "same filings: no repeat");
  const q3 = { asOf: "Q3 2026", tag: "Held by Akre Capital (new)" };
  const e = smartEvent(first.key, q3);
  assert.equal(e.fire, true);
  assert.equal(e.label, "Smart money: Akre Capital (new)");
  assert.equal(smartEvent(first.key, { asOf: "Q3 2026", tag: "Held by Akre Capital" }).fire, false, "held only: no event");
  assert.deepEqual(smartEvent(null, null), { key: null, fire: false, label: null });
});
