// 19 Nov (daily run): the pot's backtests assume fills at the official open;
// research log 19 Nov proposes measuring Douglas's real fills against the book.
import { test } from "node:test";
import assert from "node:assert/strict";
import { potAdherence, potFills } from "../src/tradeLog.js";

const PT = [
  { kind: "bounce", ticker: "ILMN", market: "US", entryDate: "2026-11-17", exitDate: "2026-11-18", entry: 200, exit: 210 },
  { kind: "drift", ticker: "BRBY", market: "UK", entryDate: "2026-11-13", exitDate: null, entry: 1170.5 },
  { kind: "bounce", ticker: "ABT", market: "US", entryDate: "2026-11-13", exitDate: null, entry: 108.2 },
];
const t = (id, date, action, ticker, price) => ({ id, date, action, ticker, rule: "swing", ...(price != null ? { price } : {}) });

test("potAdherence: each item carries the book's price for its side", () => {
  const r = potAdherence(PT, [], "2026-11-25");
  const ref = Object.fromEntries(r.items.map((i) => [`${i.side}:${i.ticker}`, i.ref]));
  assert.deepEqual(ref, { "buy:ILMN": 200, "buy:BRBY": 1170.5, "buy:ABT": 108.2, "sell:ILMN": 210 });
});

test("potFills: buys against the open, sells against the exit close, positive = cost", () => {
  const trades = [t("a", "2026-11-17", "buy", "ILMN", 200.4), t("b", "2026-11-19", "sell", "ILMN", 207.9), t("c", "2026-11-13", "buy", "BRBY", 1168.2), t("d", "2026-11-13", "buy", "ABT")];
  const f = potFills(potAdherence(PT, trades, "2026-11-25").items, trades);
  assert.equal(f.buy.n, 2, "ABT logged with no price is left out");
  assert.equal(f.buy.avg, 0, "+0.2% on ILMN and -0.2% on Burberry");
  assert.equal(f.sell.n, 1);
  assert.equal(f.sell.avg, 1.01, "210 / 207.9 - 1");
  assert.equal(f.line, "Fills against the book: buys paid 0.00% more than the open (2 orders); sells got 1.01% less than the exit close (1 order; sold a session later, as agreed). Tested costs assume fills at the open.");
});

test("potFills: nothing to say without priced, matched trades", () => {
  assert.equal(potFills([], []).line, null);
  const trades = [t("a", "2026-11-17", "buy", "ILMN")];
  assert.equal(potFills(potAdherence(PT, trades, "2026-11-25").items, trades).line, null);
  // A buy booked before its price exists (withPassedBuys) has no ref.
  const noRef = [{ kind: "drift", ticker: "TGT", market: "US", entryDate: "2026-11-19", exitDate: null }];
  const tr = [t("x", "2026-11-19", "buy", "TGT", 166)];
  assert.equal(potFills(potAdherence(noRef, tr, "2026-11-25").items, tr).line, null);
});

test("potFills: a cheaper buy reads as less, one order singular", () => {
  const trades = [t("c", "2026-11-13", "buy", "BRBY", 1159)];
  assert.equal(potFills(potAdherence(PT, trades, "2026-11-25").items, trades).line,
    "Fills against the book: buys paid 0.98% less than the open (1 order). Tested costs assume fills at the open.");
});
