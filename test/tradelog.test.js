import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseTrade, potTotals, adherence, parseImport, sortTrades } from "../src/tradeLog.js";
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
  assert.match(a.headline, /2 of 2 scheduled actions done on time/);
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
