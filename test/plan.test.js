import { test } from "node:test";
import assert from "node:assert/strict";
import { copilot, pullbackAlert, pickStatus, copilotLines, PLAN } from "../src/plan.js";

const sp = (dd) => ({ name: "S&P 500", drawdownPct: dd });
const ftse = (dd) => ({ name: "FTSE 100", drawdownPct: dd });
const item = (verdict, days) => ({ ticker: "X", longTerm: { verdict, score: 80 }, earnings: days == null ? null : { days } });

test("Monday 2 Nov: core and picks are due; picks gated by verdict and results", () => {
  const items = { "HSBA.L": item("Good entry"), META: item("Good entry", 3), NEM: item("Good entry"), STZ: item("Fair"), VICI: item("Good entry", 30) };
  const cp = copilot({ today: "2026-11-02", sp: sp(-3), ftse: ftse(-2), items });
  assert.deepEqual(cp.actions.map((a) => a.kind), ["core", "picks"]);
  const picks = cp.actions.find((a) => a.kind === "picks");
  assert.equal(picks.status, "partial");
  assert.match(picks.note, /3 of 5/);
  assert.equal(cp.picks.find((p) => p.symbol === "META").ok, false);
});

test("pullback rule fires at 5% before the next core date, once", () => {
  const cp = copilot({ today: "2026-11-05", sp: sp(-5.4), ftse: ftse(-2), items: {} });
  assert.equal(cp.pullback.triggered, true);
  assert.equal(cp.pullback.nextCore.date, "2026-11-16");
  assert.equal(cp.actions[0].kind, "pullback");
  const state = {};
  assert.ok(pullbackAlert(cp, state));
  assert.equal(pullbackAlert(cp, state), null, "only once per core date");
});

test("pullback rule ignores the April core date (money can't enter the ISA early)", () => {
  const cp = copilot({ today: "2026-12-10", sp: sp(-8), ftse: ftse(-6), items: {} });
  assert.equal(cp.pullback.triggered, false);
  assert.equal(cp.pullback.nextCore, null);
  assert.match(cp.headline, /Nothing due/);
});

test("not triggered at -4.9%; lines say how far off the trigger", () => {
  const cp = copilot({ today: "2026-11-09", sp: sp(-4.9), ftse: ftse(-1), items: {} });
  assert.equal(cp.pullback.triggered, false);
  assert.ok(copilotLines(cp).some((l) => /fires at -5%/.test(l)));
});

test("pick with no data is not ok and says so", () => {
  const p = pickStatus(PLAN.picks[0], null);
  assert.equal(p.ok, null);
  assert.equal(p.ticker, "HSBA");
});

test("pick with no next date but recent results passes with a clear reason", () => {
  const recent = { ticker: "HSBA", longTerm: { verdict: "Good entry", score: 84 }, earnings: null, lastEarnings: "2026-10-27" };
  const p = pickStatus(PLAN.picks[0], recent, "2026-11-02");
  assert.equal(p.ok, true);
  assert.match(p.reason, /Reported Tue 27 Oct; next results not due for weeks/);
  const old = { ...recent, lastEarnings: "2026-07-29" };
  assert.match(pickStatus(PLAN.picks[0], old, "2026-11-02").reason, /next estimated no earlier than Wed 27 Jan/);
  const none = { ...recent, lastEarnings: null };
  assert.match(pickStatus(PLAN.picks[0], none, "2026-11-02").reason, /No results date known/);
});

test("headline keeps fund tickers in capitals", () => {
  const cp = copilot({ today: "2026-11-03", sp: sp(-3), ftse: ftse(-2), items: {} });
  assert.match(cp.headline, /second core purchase \(VWRP\)/);
});

test("results dated yesterday read as reported, not 'in -1 days'", () => {
  const it = { ticker: "CF", longTerm: { verdict: "Good entry", score: 85 }, earnings: { date: "2026-11-04", days: -1 }, lastEarnings: null };
  const p = pickStatus(PLAN.picks[0], it, "2026-11-05");
  assert.equal(p.ok, true);
  assert.equal(p.earningsDays, null);
  assert.equal(p.lastEarnings, "2026-11-04");
  assert.match(p.reason, /Reported Wed 4 Nov/);
  assert.doesNotMatch(p.reason, /-1/);
});

test("pot targets add up to 100% and swing holds no real money (5 Nov)", () => {
  assert.equal(PLAN.pots.reduce((a, p) => a + p.target, 0), 100);
  assert.equal(PLAN.pots.find((p) => p.key === "swing").target, 0);
  assert.equal(PLAN.pots.find((p) => p.key === "core").target, 70);
});

test("resultsEstimate: cadence by market, history gaps, stale dates roll forward", async () => {
  const { resultsEstimate } = await import("../src/research.js");
  assert.equal(resultsEstimate(null, "2026-11-06"), null);
  const us = resultsEstimate("2026-10-28", "2026-11-06");
  assert.equal(us.date, "2027-01-27"); assert.equal(us.basis, "quarterly"); assert.equal(us.stale, false);
  const uk = resultsEstimate("2026-08-05", "2026-11-06", { uk: true });
  assert.equal(uk.date, "2027-02-03", "a quarter on has passed (half-yearly reporter): next quarter"); assert.equal(uk.basis, "uk-earliest"); assert.equal(uk.stale, false);
  const stale = resultsEstimate("2026-02-12", "2026-11-06", { uk: true });
  assert.equal(stale.stale, true, "nine months since the latest results: stale");
  assert.equal(stale.date, "2026-11-12");
  const hist = resultsEstimate("2026-10-27", "2026-11-06", { uk: true, history: ["2026-02-24", "2026-04-28", "2026-07-29"] });
  assert.equal(hist.basis, "history");
  assert.equal(hist.date, "2027-01-25", "median gap 90 days (quarterly UK reporter)");
});

test("pickStatus: estimate shown when no date is published, ok unchanged", async () => {
  const { pickStatus } = await import("../src/plan.js");
  const item = { longTerm: { verdict: "Good entry", score: 80 }, earnings: null, lastEarnings: "2026-08-13" };
  const st = pickStatus({ symbol: "XYZ" }, item, "2026-11-06");
  assert.equal(st.ok, true);
  assert.match(st.reason, /results usually due around Thu 12 Nov \(estimated\)/);
  const far = pickStatus({ symbol: "ABC.L" }, { ...item, lastEarnings: "2026-09-15" }, "2026-11-20");
  assert.match(far.reason, /next estimated no earlier than Tue 15 Dec/);
  const fromItem = pickStatus({ symbol: "ABC.L" }, { ...item, resultsEstimate: { date: "2026-11-10", days: 4, basis: "history", stale: false } }, "2026-11-06");
  assert.match(fromItem.reason, /due around Tue 10 Nov/, "uses the research item's history-based estimate");
});

test("core holdings' published results dates join Key dates; the manual Nvidia date gives way", async () => {
  const { coreHoldingDates } = await import("../src/plan.js");
  const items = {
    NVDA: { earnings: { date: "2026-11-18", days: 9 } },
    WMT: { earnings: { date: "2026-11-19", days: 10 } },      // not a listed holding
    AVGO: { earnings: { date: "2026-12-09", days: 30 } },     // outside 21 days
    MSFT: { earnings: null, resultsEstimate: { date: "2026-11-20" } }, // estimate only: left out
    JPM: { earnings: { date: "2026-11-01", days: -8 } },      // past
    AMD: { earnings: { date: "2026-11-12", days: 3 } },
  };
  const auto = coreHoldingDates(items, "2026-11-09");
  assert.deepEqual(auto.map((d) => d.symbol), ["NVDA", "AMD"]);
  assert.equal(auto[0].title, "Nvidia results, about 5% of VWRP");
  assert.equal(auto[1].title, "AMD results, about 0.7% of VWRP");
  const cp = copilot({ today: "2026-11-09", sp: null, ftse: null, items });
  assert.deepEqual(cp.dates.map((d) => d.date), ["2026-11-12", "2026-11-18"], "sorted; manual 17 Nov Nvidia entry replaced by Yahoo's date");
  assert.ok(copilotLines(cp).some((l) => /AMD results, about 0\.7% of VWRP \(Thu 12 Nov\)/.test(l)));
  const none = copilot({ today: "2026-11-09", sp: null, ftse: null, items: {} });
  assert.ok(none.dates.some((d) => d.symbol === "NVDA" && d.date === "2026-11-17"), "manual date kept without scan data");
  assert.deepEqual(coreHoldingDates({}, null), []);
});

test("core holdings: small ones show only in the last week; extras come from quotes", async () => {
  const { coreHoldingDates, coreExtras, coreExtraDates } = await import("../src/plan.js");
  const { earningsFields } = await import("../src/research.js");
  const items = {
    TSM: { earnings: { date: "2026-11-25" } },          // 1.7%: within 21 days
    "005930.KS": { earnings: { date: "2026-11-25" } },  // 0.8%: 16 days out, left out
    XOM: { earnings: { date: "2026-11-14" } },          // 0.6%: 5 days, shown
  };
  const auto = coreHoldingDates(items, "2026-11-09");
  assert.deepEqual(auto.map((d) => d.symbol), ["TSM", "XOM"]);
  assert.equal(auto[0].title, "TSMC results, about 2% of VWRP");
  assert.deepEqual(coreExtras().map((h) => h.symbol), ["TSM", "005930.KS", "000660.KS"]);
  const toFund = (q) => (q ? { nextEarnings: q.next ?? null, lastEarnings: q.last ?? null } : null);
  const ex = coreExtraDates({ TSM: { next: "2027-01-15" }, "005930.KS": { last: "2026-10-30" } }, toFund, earningsFields, "2026-11-09");
  assert.deepEqual(ex, [
    { symbol: "TSM", name: "TSMC", earnings: { date: "2027-01-15", days: 67 }, lastEarnings: null },
    { symbol: "005930.KS", name: "Samsung Electronics", earnings: null, lastEarnings: "2026-10-30" },
  ]);
});
