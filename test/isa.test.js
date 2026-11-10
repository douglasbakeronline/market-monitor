import { test } from "node:test";
import assert from "node:assert/strict";
import { taxYearOf, isaSummary, mergeCash } from "../src/isa.js";
import { parseT212 } from "../src/tradeLog.js";

test("tax year runs 6 April to 5 April", () => {
  assert.equal(taxYearOf("2026-11-10").label, "2026/27");
  assert.equal(taxYearOf("2027-04-05").label, "2026/27");
  assert.equal(taxYearOf("2027-04-06").label, "2027/28");
  assert.equal(taxYearOf("2026-11-10").next, "2027-04-06");
});

test("ISA summary for this tax year", () => {
  const ev = [
    { id: "a", date: "2026-03-01", kind: "deposit", amount: 5000 }, // last tax year
    { id: "b", date: "2026-05-01", kind: "deposit", amount: 8000 },
    { id: "c", date: "2026-11-02", kind: "deposit", amount: 7000 },
    { id: "d", date: "2026-11-06", kind: "dividend", amount: 0.34, ticker: "VICI" },
    { id: "e", date: "2026-11-07", kind: "interest", amount: 1.2 },
    { id: "f", date: "2026-11-08", kind: "withdrawal", amount: 100 },
  ];
  const s = isaSummary(ev, "2026-11-10");
  assert.equal(s.taxYear, "2026/27");
  assert.equal(s.deposits, 15000);
  assert.equal(s.remaining, 5000);
  assert.equal(s.dividends, 0.34);
  assert.equal(s.interest, 1.2);
  assert.equal(s.withdrawals, 100);
  assert.equal(s.daysToNext, 147);
  assert.deepEqual(s.dividendsBy, [["VICI", 0.34]]);
  assert.equal(isaSummary([{ date: "2026-06-01", kind: "deposit", amount: 21000 }], "2026-11-10").over, true);
  assert.equal(mergeCash([{ id: "a" }], [{ id: "a" }, { id: "b" }]).length, 2);
});

test("Trading 212 import returns cash movements", () => {
  const csv = [
    "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),ID",
    "Deposit,2026-11-01 09:00:00,,,,,,,,,,1000.00,GBP,D1",
    "Withdrawal,2026-11-03 09:00:00,,,,,,,,,,-50.00,GBP,W1",
    "Dividend (Dividend),2026-11-06 12:00:00,US92936U1097,VICI,VICI,1,0.45,USD,,,,0.34,GBP,",
    "Interest on cash,2026-11-07 00:00:00,,,,,,,,,,0.12,GBP,I1",
  ].join("\n");
  const r = parseT212(csv, { today: "2026-11-10" });
  assert.deepEqual(r.cash.map((e) => [e.kind, e.amount, e.ticker ?? null]), [["deposit", 1000, null], ["withdrawal", 50, null], ["dividend", 0.34, "VICI"], ["interest", 0.12, null]]);
  assert.equal(r.cash[0].id, "t212c-D1");
  assert.equal(r.dividends, 0.34);
});
