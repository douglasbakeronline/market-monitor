import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseTrade, potTotals, adherence, parseImport, sortTrades, dipEvents } from "../src/tradeLog.js";
import { PLAN } from "../src/plan.js";

const T = (o) => normaliseTrade({ action: "buy", ...o }).trade;

test("normaliseTrade validates and cleans", () => {
  assert.match(normaliseTrade({ date: "2/11/26", action: "buy", rule: "core", ticker: "VWRP" }).error, /YYYY-MM-DD/);
  assert.match(normaliseTrade({ date: "2026-11-20", action: "buy", rule: "core", ticker: "VWRP" }, "2026-11-05").error, /future/);
  assert.match(normaliseTrade({ date: "2026-11-02", action: "buy", rule: "nope", ticker: "VWRP" }).error, /rule/);
  assert.match(normaliseTrade({ date: "2026-11-02", action: "buy", rule: "core", ticker: "VWRP", amount: "-5" }).error, /positive/);
  const { trade } = normaliseTrade({ date: "2026-11-02", action: "buy", rule: "tranche", ticker: " hsba.l ", amount: "£1,234.567" });
  assert.equal(trade.ticker, "HSBA.L");
  assert.equal(trade.pot, "picks", "pot defaults from the rule");
  assert.equal(trade.amount, 1234.57);
  assert.equal(normaliseTrade({ date: "2026-11-02", action: "buy", rule: "core", ticker: "VWRP", amount: "" }).trade.amount, null);
});

test("potTotals nets buys and sells and skips blank amounts", () => {
  const ts = [T({ date: "2026-11-02", rule: "core", ticker: "VWRP", amount: 100 }), T({ date: "2026-11-02", rule: "tranche", ticker: "META", amount: 30 }),
    { ...T({ date: "2026-11-03", rule: "other", ticker: "META", amount: 10, pot: "picks" }), action: "sell" }, T({ date: "2026-11-03", rule: "core", ticker: "VWRP" })];
  const p = potTotals(ts);
  assert.equal(p.core, 100); assert.equal(p.picks, 20); assert.equal(p.total, 120); assert.equal(p.counted, 3);
});

test("adherence: 2 Nov core and picks done on time; 16 Nov pending until a week late", () => {
  const ts = [T({ date: "2026-11-02", rule: "core", ticker: "VWRP" }), T({ date: "2026-11-02", rule: "tranche", ticker: "HSBA.L" }), T({ date: "2026-11-03", rule: "tranche", ticker: "META" })];
  const a = adherence(PLAN.schedule, ts, "2026-11-05");
  assert.equal(a.counted, 2); assert.equal(a.onTime, 2);
  assert.match(a.headline, /2 of 2 plan actions done on time/);
  assert.deepEqual(a.items.find((i) => i.kind === "picks").tickers, ["HSBA.L", "META"]);
  const later = adherence(PLAN.schedule, ts, "2026-11-20");
  assert.equal(later.items.find((i) => i.date === "2026-11-16").status, "pending");
  const missed = adherence(PLAN.schedule, ts, "2026-11-24");
  assert.equal(missed.items.find((i) => i.date === "2026-11-16").status, "missed");
  assert.match(missed.headline, /2 of 3/);
});

test("adherence: pullback buy before the date counts on time; a core buy fills one date only", () => {
  const ts = [T({ date: "2026-11-02", rule: "core", ticker: "VWRP" }), T({ date: "2026-11-10", rule: "pullback", ticker: "VWRP" })];
  const a = adherence(PLAN.schedule, ts, "2026-11-24");
  assert.equal(a.items.find((i) => i.date === "2026-11-02").status, "on-time");
  assert.equal(a.items.find((i) => i.date === "2026-11-16").status, "on-time");
  const one = adherence(PLAN.schedule, [T({ date: "2026-11-04", rule: "core", ticker: "VWRP" })], "2026-11-24");
  assert.equal(one.items.find((i) => i.date === "2026-11-02").status, "late");
  assert.equal(one.items.find((i) => i.date === "2026-11-16").status, "missed", "the same trade can't fill both dates");
});

test("adherence ignores sells and counts off-plan trades", () => {
  const ts = [{ ...T({ date: "2026-11-02", rule: "core", ticker: "VWRP" }), action: "sell" }, T({ date: "2026-11-02", rule: "other", ticker: "TSLA" })];
  const a = adherence(PLAN.schedule, ts, "2026-11-12");
  assert.equal(a.items.find((i) => i.kind === "core").status, "missed");
  assert.equal(a.offPlan, 1);
});

test("parseImport accepts an array or { trades } and skips bad rows; sortTrades newest first", () => {
  const good = { date: "2026-11-02", action: "buy", rule: "core", ticker: "VWRP" };
  assert.equal(parseImport(JSON.stringify([good, { date: "x" }])).trades.length, 1);
  assert.equal(parseImport(JSON.stringify({ trades: [good] })).skipped, 0);
  assert.match(parseImport("nope").error, /JSON/);
  const s = sortTrades([T({ ...good, date: "2026-11-01" }), T({ ...good, date: "2026-11-03" })]);
  assert.equal(s[0].date, "2026-11-03");
});

test("dipEvents: one item per tier, the second index or a quick re-fire is the same third", () => {
  const sig = (date, name, pct) => ({ kind: "buy", date, name, label: `BUY · ${name} Tier (${pct}%)` });
  const ev = dipEvents([sig("2026-11-20", "FTSE 100", -10), sig("2026-11-18", "S&P 500", -10), sig("2026-11-25", "S&P 500", -15),
    { kind: "watch", date: "2026-11-10", label: "WATCH (-10%)" }, sig("2027-03-01", "S&P 500", -10)]);
  assert.deepEqual(ev.map((e) => [e.date, e.tier]), [["2026-11-18", "-10"], ["2026-11-25", "-15"], ["2027-03-01", "-10"]]);
  assert.match(ev[0].title, /S&P 500/);
});

test("adherence: dip tiers join the list and match only dip-rule buys within a week", () => {
  const dips = dipEvents([{ kind: "buy", date: "2026-11-18", name: "S&P 500", label: "BUY · S&P 500 Correction (-10%)" }]);
  const core = [T({ date: "2026-11-02", rule: "core", ticker: "VWRP" }), T({ date: "2026-11-02", rule: "tranche", ticker: "META" }), T({ date: "2026-11-16", rule: "core", ticker: "VWRP" })];
  assert.equal(adherence(PLAN.schedule, core, "2026-11-17", dips).items.length, 3, "not due before it fires");
  const open = adherence(PLAN.schedule, core, "2026-11-20", dips);
  const d = open.items.find((i) => i.kind === "dip");
  assert.equal(d.status, "pending");
  assert.equal(open.items.at(-1).kind, "dip", "sorted by date");
  const done = adherence(PLAN.schedule, [...core, T({ date: "2026-11-19", rule: "dip", ticker: "VWRP" }), T({ date: "2026-11-19", rule: "dip", ticker: "HSBA.L" })], "2026-11-30", dips);
  const dd = done.items.find((i) => i.kind === "dip");
  assert.equal(dd.status, "on-time"); assert.deepEqual(dd.tickers, ["VWRP", "HSBA.L"]);
  const late = adherence(PLAN.schedule, [...core, T({ date: "2026-11-24", rule: "dip", ticker: "VWRP" })], "2026-11-30", dips);
  assert.equal(late.items.find((i) => i.kind === "dip").status, "late");
  const early = adherence(PLAN.schedule, [...core, T({ date: "2026-11-10", rule: "dip", ticker: "VWRP" })], "2026-11-30", dips);
  assert.equal(early.items.find((i) => i.kind === "dip").status, "missed", "a buy before the tier fired is not this tier");
});

test("adherence counts unpaused reserve drips", () => {
  const sched = [{ date: "2026-12-07", kind: "drip", title: "Drip" }, { date: "2027-01-04", kind: "drip", paused: true, title: "Paused" }];
  const tr = [normaliseTrade({ date: "2026-12-08", action: "buy", rule: "drip", ticker: "VWRP", amount: 100 }).trade];
  const a = adherence(sched, tr, "2027-01-20");
  assert.deepEqual(a.items.map((i) => [i.date, i.status]), [["2026-12-07", "on-time"]]);
});

test("normaliseTrade keeps an optional price per share", () => {
  assert.equal(normaliseTrade({ date: "2026-11-02", action: "buy", rule: "tranche", ticker: "META", amount: "300", price: "$612.40" }).trade.price, 612.4);
  assert.equal("price" in normaliseTrade({ date: "2026-11-02", action: "buy", rule: "tranche", ticker: "META", amount: "300", price: "" }).trade, false);
  assert.match(normaliseTrade({ date: "2026-11-02", action: "buy", rule: "tranche", ticker: "META", price: "-1" }).error, /Price/);
});

test("Trading 212 CSV: buys and sells become trades, dividends are summed", async () => {
  const { parseT212, isT212Csv, parseCsv } = await import("../src/tradeLog.js");
  const csv = [
    "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),ID",
    'Deposit,2026-11-01 09:00:00,,,,,,,,,,1000.00,GBP,D1',
    'Market buy,2026-11-02 08:05:11,IE00BK5BQT80,VWRP,"Vanguard FTSE All-World UCITS ETF (Acc)",5.1234,137.20,GBP,1.00,,,702.94,GBP,EOF1',
    'Market buy,2026-11-02 14:31:02,US30303M1027,META,"Meta Platforms, Inc.",0.4,612.40,USD,0.76,,,186.50,GBP,EOF2',
    'Limit buy,2026-11-02 08:10:00,GB0005405286,HSBA,HSBC Holdings,10,1310.0,GBX,100,,,131.00,GBP,EOF3',
    'Market sell,2026-11-05 10:00:00,US0000000001,XYZ,Old Holding,3,10,USD,0.76,1.2,GBP,22.80,GBP,EOF4',
    'Dividend (Dividend),2026-11-06 12:00:00,US92936U1097,VICI,VICI,1,0.45,USD,,,,0.34,GBP,',
    'Interest on cash,2026-11-07 00:00:00,,,,,,,,,,0.12,GBP,I1',
  ].join("\n");
  assert.equal(isT212Csv(csv), true);
  assert.equal(isT212Csv('{"trades":[]}'), false);
  const r = parseT212(csv, { picks: ["META", "HSBA", "NEM"], today: "2026-11-10" });
  assert.deepEqual(r.trades.map((t) => [t.ticker, t.action, t.pot, t.rule, t.amount, t.price]), [
    ["VWRP", "buy", "core", "core", 702.94, 137.2],
    ["META", "buy", "picks", "tranche", 186.5, 612.4],
    ["HSBA", "buy", "picks", "tranche", 131, 1310],
    ["XYZ", "sell", "core", "other", 22.8, 10],
  ]);
  assert.equal(r.trades[0].id, "t212-EOF1");
  assert.equal(r.trades[1].shares, 0.4);
  assert.equal(r.dividends, 0.34);
  assert.equal(r.dividendCount, 1);
  assert.equal(parseCsv('a,"b, ""c"""\n1,2').length, 2);
  assert.match(parseT212("foo,bar\n1,2").error, /Trading 212/);
});

test("Trading 212 import totals the FX fee and stamp duty as a share of the money traded", async () => {
  const { parseT212 } = await import("../src/tradeLog.js");
  const csv = [
    "Action,Time,Ticker,No. of shares,Price / share,Total,Currency (Total),Stamp duty reserve tax,Currency (Stamp duty reserve tax),Currency conversion fee,Currency (Currency conversion fee),ID",
    "Market buy,2026-11-02 08:01:00,HSBA,10,1300,1000.00,GBP,5.00,GBP,,,A1",
    "Market buy,2026-11-02 14:31:00,META,1,640,500.00,GBP,,,0.75,GBP,A2",
    "Market sell,2026-11-05 14:31:00,META,1,650,500.00,GBP,,,0.75,GBP,A3",
    "Deposit,2026-11-01 09:00:00,,,,2000.00,GBP,,,,,D1",
  ].join("\n");
  const r = parseT212(csv, { picks: ["META", "HSBA"], today: "2026-11-10" });
  assert.equal(r.costs.trades, 3);
  assert.equal(r.costs.traded, 2000);
  assert.equal(r.costs.stamp, 5);
  assert.equal(r.costs.fx, 1.5);
  assert.equal(r.costs.pct, 0.33);
  assert.equal(r.costs.columns, true);
  const bare = parseT212("Action,Time,Ticker,Total,Currency (Total),ID\nMarket buy,2026-11-02 08:01:00,VWRP,100,GBP,X", { today: "2026-11-10" });
  assert.equal(bare.costs.total, 0);
  assert.equal(bare.costs.columns, false);
});
