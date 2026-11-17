import { test } from "node:test";
import assert from "node:assert/strict";
import { shortPot, shortPotLine } from "../src/shortPot.js";
import { shortPauseAlert, WARN_FALL } from "../src/shortTerm.js";

const tr = (o) => ({ market: "US", name: o.symbol, ticker: o.symbol, signalPrice: 10, ...o, id: `${o.signalDate}:${o.kind}:${o.symbol}` });
const rules = { maxOpen: 5, pauseFall: 0.25 };

test("shortPot: fallPct measures the value against the closed-trade high", () => {
  const p = shortPot([
    tr({ kind: "drift", symbol: "A", signalDate: "2026-11-11", status: "closed", entryDate: "2026-11-12", entry: 10, exitDate: "2026-11-13", exit: 12, netPct: 50 }),
    tr({ kind: "drift", symbol: "B", signalDate: "2026-11-13", status: "open", entryDate: "2026-11-16", entry: 10, netPct: -50, sessions: 3 }),
  ]);
  assert.equal(p.peak, 11000);
  assert.equal(p.value, 11000 - 2200 * 0.5);
  assert.equal(p.fallPct, -10);
  assert.equal(shortPot([]).fallPct, 0);
});

test("shortPauseAlert: one heads-up at 15%, one pause alert, reset after recovery", () => {
  const pot = (fallPct, paused = false) => ({ rules, fallPct, paused, returnPct: fallPct, closed: 2, winRate: 50, open: [{ ticker: "X", openPct: -4.2 }] });
  let r = shortPauseAlert(pot(-3), null);
  assert.equal(r.alert, null); assert.equal(r.stage, null);
  r = shortPauseAlert(pot(-WARN_FALL - 1), null);
  assert.equal(r.stage, "warn"); assert.match(r.alert.title, /16\.0% below its high/); assert.equal(r.alert.kind, "short");
  r = shortPauseAlert(pot(-18), "warn");
  assert.equal(r.alert, null, "no repeat while still in the warn stage");
  r = shortPauseAlert(pot(-12), "warn");
  assert.equal(r.alert, null); assert.equal(r.stage, "warn", "between 5% and 15%, the stage holds");
  r = shortPauseAlert(pot(-26, true), "warn");
  assert.equal(r.stage, "paused"); assert.equal(r.alert.priority, "high"); assert.match(r.alert.body, /Held: X -4\.2%/);
  r = shortPauseAlert(pot(-27, true), "paused");
  assert.equal(r.alert, null);
  r = shortPauseAlert(pot(-2), "paused");
  assert.equal(r.stage, null, "recovered to within 5%: armed again");
  assert.equal(shortPauseAlert(pot(-26, true), null).stage, "paused", "a jump straight to the pause sends the pause alert");
  assert.deepEqual(shortPauseAlert(null, "warn"), { alert: null, stage: "warn" });
});

test("shortPotLine: digest line before and after the first trades", () => {
  assert.equal(shortPotLine(null), null);
  assert.equal(shortPotLine({ rules, start: null, buys: [{}, {}] }), "Short-term pot (real money): no trades yet; 2 to buy at the next open.");
  assert.equal(shortPotLine({ rules, start: "2026-11-12", returnPct: 1.234, open: [{}, {}], closed: 3, winRate: 67, avgNetPct: 0.8, fallPct: -2, paused: false }),
    "Short-term pot (real money): +1.2% since 2026-11-12; 2 of 5 slots held; 3 closed, 67% won, avg +0.8% after costs; 2.0% below its high (pauses at 25%).");
  assert.match(shortPotLine({ rules, start: "2026-11-12", returnPct: -26, open: [], closed: 0, paused: true }), /none closed yet; PAUSED/);
});

import { potTradeFor, potAdherence, parseT212, withPassedBuys } from "../src/tradeLog.js";

const PT = [
  { kind: "drift", ticker: "TTWO", market: "US", entryDate: "2026-11-12", exitDate: "2026-12-09" },
  { kind: "bounce", ticker: "BARC", market: "UK", entryDate: "2026-11-12", exitDate: "2026-11-16" },
  { kind: "drift", ticker: "AKAM", market: "US", entryDate: "2026-11-12", exitDate: null },
];

test("shortPot: exposes the trades it took for the trade log", () => {
  const p = shortPot([tr({ kind: "drift", symbol: "A", signalDate: "2026-11-11", status: "closed", entryDate: "2026-11-12", entry: 10, exitDate: "2026-11-13", exit: 12, netPct: 5 })]);
  assert.deepEqual(p.trades, [{ kind: "drift", ticker: "A", market: "US", entryDate: "2026-11-12", exitDate: "2026-11-13" }]);
});

test("potTradeFor: buys near the entry open, sells after entry up to a week past the exit", () => {
  assert.equal(potTradeFor(PT, "TTWO", "2026-11-11", "buy")?.ticker, "TTWO", "order placed the evening before");
  assert.equal(potTradeFor(PT, "TTWO", "2026-11-20", "buy"), null);
  assert.equal(potTradeFor(PT, "BARC.L", "2026-11-17", "sell")?.ticker, "BARC");
  assert.equal(potTradeFor(PT, "BARC", "2026-11-30", "sell"), null);
  assert.equal(potTradeFor(PT, "AKAM", "2026-11-20", "sell")?.ticker, "AKAM", "an open trade sold early still belongs to the pot");
  assert.equal(potTradeFor(PT, "MSFT", "2026-11-12", "buy"), null);
});

test("potAdherence: on time, late, pending and missed", () => {
  const t = (id, date, action, ticker, rule = "swing") => ({ id, date, action, ticker, rule });
  const r = potAdherence(PT, [t("a", "2026-11-12", "buy", "TTWO"), t("b", "2026-11-16", "buy", "BARC"), t("c", "2026-11-17", "sell", "BARC"), t("d", "2026-11-12", "buy", "AKAM", "other")], "2026-11-25");
  const st = Object.fromEntries(r.items.map((i) => [`${i.side}:${i.ticker}`, i.status]));
  assert.deepEqual(st, { "buy:TTWO": "on-time", "buy:BARC": "late", "buy:AKAM": "missed", "sell:BARC": "on-time" });
  assert.equal(r.headline, "Short-term pot: 2 of 4 orders logged on time");
  const early = potAdherence(PT, [], "2026-11-12");
  assert.equal(early.headline, "Short-term pot: 3 orders not yet logged");
  assert.equal(potAdherence([], [], "2026-11-12").headline, null);
  // 17 Nov: "0 of 1 order logged on time" then six names listed as not logged
  // read as a miscount; orders still inside their window now say so.
  const mid = potAdherence(PT, [], "2026-11-18");
  assert.equal(mid.headline, "Short-term pot: 0 of 3 orders logged on time; 1 more still open to log");
  // 17 Nov: the not-logged list said "sell OTIS Mon 16 Nov", the exit close,
  // though the order was for the 17 Nov open. Each item carries its open.
  const od = Object.fromEntries(potAdherence([...PT, { kind: "bounce", ticker: "OTIS", market: "US", entryDate: "2026-11-12", exitDate: "2026-11-13" }], [], "2026-11-25").items.map((i) => [`${i.side}:${i.ticker}`, i.orderDate]));
  assert.equal(od["sell:BARC"], "2026-11-17", "Mon 16 Nov close, sold at the Tue open");
  assert.equal(od["sell:OTIS"], "2026-11-16", "a Friday exit sells at Monday's open");
  assert.equal(od["buy:TTWO"], "2026-11-12", "a buy's date is already its open");

});

// 17 Nov (19:41): between an open and the evening scan, that open's buys were
// missing from the trade log's not-logged list (pot.trades only gains them when
// the scan books the entry). Listed buys whose open has passed now count.
test("withPassedBuys: a listed buy joins the pot trades once its open has passed", () => {
  const trades = [{ kind: "bounce", ticker: "OTIS", market: "US", entryDate: "2026-11-12", exitDate: "2026-11-16" }];
  const buys = [{ kind: "bounce", symbol: "ILMN", ticker: "ILMN", market: "US", signalDate: "2026-11-16" }, { kind: "drift", symbol: "BARC.L", ticker: "BARC", market: "UK", signalDate: "2026-11-16" }];
  const at = (iso) => new Date(iso);
  // 17 Nov 10:00 London: BARC's 08:00 open has passed, ILMN's 14:30 has not.
  assert.deepEqual(withPassedBuys(trades, buys, at("2026-11-17T10:00:00Z")).map((t) => `${t.ticker}@${t.entryDate}`), ["OTIS@2026-11-12", "BARC@2026-11-17"]);
  // 19:45 London: both opens have passed.
  const eve = withPassedBuys(trades, buys, at("2026-11-17T19:45:00Z"));
  assert.deepEqual(eve.map((t) => `${t.ticker}@${t.entryDate}`), ["OTIS@2026-11-12", "ILMN@2026-11-17", "BARC@2026-11-17"]);
  assert.deepEqual(eve[1], { kind: "bounce", ticker: "ILMN", market: "US", entryDate: "2026-11-17", exitDate: null });
  // Once the scan has booked it, it is not added twice.
  const booked = [...trades, { kind: "bounce", ticker: "ILMN", market: "US", entryDate: "2026-11-17", exitDate: null }];
  assert.equal(withPassedBuys(booked, buys.slice(0, 1), at("2026-11-17T19:45:00Z")).length, 2);
  // Evening before the open: nothing added; no buys or a missing list is safe.
  assert.equal(withPassedBuys(trades, buys, at("2026-11-16T22:00:00Z")).length, 1);
  assert.deepEqual(withPassedBuys(undefined, undefined, at("2026-11-17T19:45:00Z")), []);
  // The trade log then lists ILMN as an order still open to log.
  const r = potAdherence(eve, [], "2026-11-17");
  assert.ok(r.items.some((i) => i.side === "buy" && i.ticker === "ILMN" && i.status === "pending" && i.orderDate === "2026-11-17"));
});

test("parseT212: pot orders land in the short-term pot", () => {
  const csv = ["Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total),ID",
    "Market buy,2026-11-12 08:01:02,X,BARC,Barclays,100,400,GBX,400.00,GBP,EOF1",
    "Market buy,2026-11-12 14:31:00,X,MSFT,Microsoft,1,400,USD,300.00,GBP,EOF2",
    "Market sell,2026-11-17 08:00:30,X,BARC,Barclays,100,410,GBX,410.00,GBP,EOF3"].join("\n");
  const r = parseT212(csv, { short: PT, today: "2026-11-20" });
  assert.deepEqual(r.trades.map((x) => `${x.ticker}:${x.rule}:${x.pot}`), ["BARC:swing:swing", "MSFT:other:core", "BARC:swing:swing"]);
});

// 17 Nov (22:41): the trade log listed only the newest six open orders, so
// the one missed order (buy OTIS 12 Nov, counted as "0 of 1") was cut off.
// Missed orders now always lead the list; open ones follow, newest kept.
import { potNotLogged } from "../src/tradeLog.js";
test("potNotLogged: missed orders are never cut from the list", () => {
  const it = (side, ticker, date, status) => ({ side, ticker, date, orderDate: date, status });
  const items = [it("buy", "OTIS", "2026-11-12", "missed"), it("buy", "TTWO", "2026-11-12", "on-time"),
    ...["BRBY", "ABT", "AMCR", "IFF"].map((t) => it("buy", t, "2026-11-13", "pending")),
    it("sell", "OTIS", "2026-11-16", "pending"), it("buy", "ILMN", "2026-11-17", "pending")];
  const r = potNotLogged(items, 6);
  assert.deepEqual(r.missed.map((i) => i.ticker), ["OTIS"]);
  assert.deepEqual(r.open.map((i) => `${i.side}:${i.ticker}`), ["buy:ABT", "buy:AMCR", "buy:IFF", "sell:OTIS", "buy:ILMN"]);
  assert.equal(r.more, 1, "BRBY, the oldest open order, is the one left out");
  const all = potNotLogged(items, 10);
  assert.equal(all.open.length, 6);
  assert.equal(all.more, 0);
  // Many missed: missed still fill the list first.
  const many = potNotLogged([...Array(8)].map((_, i) => it("buy", `M${i}`, "2026-11-0" + (i + 1), "missed")), 6);
  assert.equal(many.missed.length, 6);
  assert.equal(many.missed[0].ticker, "M2", "the newest missed are kept");
  assert.equal(many.more, 2);
  assert.deepEqual(potNotLogged([], 6), { missed: [], open: [], more: 0 });
});
