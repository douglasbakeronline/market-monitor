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

import { potTradeFor, potAdherence, parseT212 } from "../src/tradeLog.js";

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
});

test("parseT212: pot orders land in the short-term pot", () => {
  const csv = ["Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total),ID",
    "Market buy,2026-11-12 08:01:02,X,BARC,Barclays,100,400,GBX,400.00,GBP,EOF1",
    "Market buy,2026-11-12 14:31:00,X,MSFT,Microsoft,1,400,USD,300.00,GBP,EOF2",
    "Market sell,2026-11-17 08:00:30,X,BARC,Barclays,100,410,GBX,410.00,GBP,EOF3"].join("\n");
  const r = parseT212(csv, { short: PT, today: "2026-11-20" });
  assert.deepEqual(r.trades.map((x) => `${x.ticker}:${x.rule}:${x.pot}`), ["BARC:swing:swing", "MSFT:other:core", "BARC:swing:swing"]);
});
