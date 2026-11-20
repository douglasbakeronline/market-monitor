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
  const plan = { ...PLAN, schedule: PLAN.schedule.filter((x) => x.kind !== "short") };
  const cp = copilot({ today: "2026-11-03", sp: sp(-3), ftse: ftse(-2), items: {}, plan });
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

test("pot targets add up to 100%; the short-term pot is 10%, from the core (11 Nov)", () => {
  assert.equal(PLAN.pots.reduce((a, p) => a + p.target, 0), 100);
  assert.equal(PLAN.pots.find((p) => p.key === "swing").target, 10);
  assert.equal(PLAN.pots.find((p) => p.key === "core").target, 60);
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
  assert.equal(auto[1].title, "AMD results, about 0.9% of VWRP");
  const cp = copilot({ today: "2026-11-09", sp: null, ftse: null, items });
  assert.deepEqual(cp.dates.map((d) => d.date), ["2026-11-12", "2026-11-18"], "sorted; manual 17 Nov Nvidia entry replaced by Yahoo's date");
  assert.ok(copilotLines(cp).some((l) => /AMD results, about 0\.9% of VWRP \(Thu 12 Nov\)/.test(l)));
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

test("reserve drip: first Monday of each month from 7 Dec, paused within 30 days of a confirmed tier", async () => {
  const { dripSchedule, copilot } = await import("../src/plan.js");
  const d = dripSchedule("2026-11-10", "2027-03-31", ["2027-01-20"]);
  assert.deepEqual(d.map((x) => [x.date, x.paused]), [["2026-12-07", false], ["2027-01-04", false], ["2027-02-01", true], ["2027-03-01", false]]);
  assert.match(d[2].detail, /confirmed on Wed 20 Jan/);
  const cp = copilot({ today: "2026-12-03", sp: null, ftse: null });
  assert.equal(cp.actions[0].kind, "drip");
  assert.equal(cp.actions[0].status, "due");
  const paused = copilot({ today: "2027-01-29", sp: null, ftse: null, tiers: ["2027-01-20"] });
  assert.equal(paused.actions[0].status, "hold");
  assert.equal(paused.upcoming[0].date, "2027-03-01", "paused drips are not 'next'");
  assert.equal(copilot({ today: "2026-12-03", sp: null, ftse: null }).pullback.nextCore, null, "a drip is not a core date for the pullback rule");
});

test("bench status: good entries first, then near ones; one line for the push", async () => {
  const { benchStatus, benchLine } = await import("../src/plan.js");
  const items = {
    SCHW: { ticker: "SCHW", longTerm: { verdict: "Fair", score: 76, near: true, gaps: ["Entry 67, needs 70"] } },
    "LLOY.L": { ticker: "LLOY", longTerm: { verdict: "Good entry", score: 77, gaps: [] } },
    AMZN: { ticker: "AMZN", longTerm: { verdict: "Fair", score: 63, gaps: ["score 63, needs 72"] } },
  };
  const b = benchStatus(items);
  assert.deepEqual(b.slice(0, 3).map((x) => x.ticker), ["LLOY", "SCHW", "AMZN"]);
  assert.equal(b.length, 6);
  assert.equal(benchLine(b), "Bench: good entry LLOY 77; close: SCHW (Entry 67, needs 70).");
  assert.equal(benchLine([]), null);
});

test("notes and paused drips are shown but not counted as actions", async () => {
  const { copilot } = await import("../src/plan.js");
  const c = copilot({ today: "2026-11-10", sp: null, ftse: null });
  assert.deepEqual(c.actions.map((a) => a.status), ["due", "due"]);
  assert.equal(c.headline, "2 plan actions this week");
  const p = copilot({ today: "2027-01-29", sp: null, ftse: null, tiers: ["2027-01-20"] });
  assert.match(p.headline, /^Nothing due this week/);
});

test("pick results line: once per results date, silent on the first run", async () => {
  const { pickResultsLine } = await import("../src/plan.js");
  const it = { symbol: "META", ticker: "META", lastResults: { date: "2027-01-28", pending: false, pct: -4.2 }, longTerm: { verdict: "Fair", score: 74, gaps: ["Entry 66, needs 70"] } };
  assert.equal(pickResultsLine(it, "2026-10-29"), "META (a pick) reported Thu 28 Jan: -4.2% from the close before to the close after. Long-term now Fair 74 (Entry 66, needs 70).");
  assert.equal(pickResultsLine(it, "2027-01-28"), null, "already announced");
  assert.equal(pickResultsLine(it, undefined), null, "first run records silently");
  assert.equal(pickResultsLine({ ...it, lastResults: { date: "2027-01-28", pending: true } }, null), null, "reaction not in yet");
  assert.equal(pickResultsLine({ ...it, symbol: "AAPL" }, null), null, "not a pick");
  assert.match(pickResultsLine(it, null), /reported Thu 28 Jan/);
  assert.match(pickResultsLine(it, null, undefined, { typical: 5.5, n: 4 }), /-4\.2% from the close before to the close after\. Its results days usually move it ±5\.5% \(last 4\)\. Long-term now/);
});

test("picks week line for the digest", async () => {
  const { picksWeekLine } = await import("../src/plan.js");
  const items = { "HSBA.L": { ticker: "HSBA", perf: { week: 2.54 }, longTerm: { verdict: "Good entry", score: 73 } }, META: { ticker: "META", perf: { week: -1.2 }, longTerm: { verdict: "Fair", score: 77 } } };
  assert.equal(picksWeekLine(items), "Your picks this week: HSBA +2.5% (Good entry 73), META -1.2% (Fair 77).");
  assert.equal(picksWeekLine({}), null);
});

test("picks line for the Monday push", async () => {
  const { picksLine } = await import("../src/plan.js");
  const picks = [
    { ticker: "HSBA", ok: true, verdict: "Good entry" },
    { ticker: "META", ok: false, verdict: "Fair", gaps: ["Entry 69, needs 70"] },
    { ticker: "NEM", ok: false, verdict: "Good entry", earningsDays: 3 },
    { ticker: "VICI", ok: null },
  ];
  assert.equal(picksLine(picks), "Picks: HSBA passes; wait: META (Entry 69, needs 70), NEM (results in 3 days).");
  assert.equal(picksLine([]), null);
  const flagged = picks.map((p) => (p.ticker === "HSBA" ? { ...p, resultsCheck: { tone: "watch" } } : p));
  assert.match(picksLine(flagged), /last results: HSBA weak results and a fall \(display only\)\.$/);
});

test("sell signals on picks: push line and picks line", async () => {
  const { pickSellLine, picksLine } = await import("../src/plan.js");
  const it = { symbol: "META", ticker: "META", exit: { kinds: ["trendBreak"] } };
  assert.equal(pickSellLine(it, { all: { byKind: { trendBreak: { verdict: "no edge" } } } }), "META (a pick): broke below its 200-day; showed no reliable edge in our test. Picks have no sell rule except the 5% ceiling; display only.");
  assert.equal(pickSellLine({ ...it, symbol: "AAPL" }), null);
  assert.equal(pickSellLine({ ...it, exit: { kinds: [] } }), null);
  assert.match(picksLine([{ ticker: "META", ok: false, verdict: "Fair", gaps: ["Entry 69, needs 70"], exit: { kinds: ["bigFall"] } }]), /sell signals today: META fell 8%\+ in a day \(display only\)\.$/);
});

test("money check verdict names a core purchase due this week (16 Nov said none was scheduled)", async () => {
  const { moneyCheckVerdict } = await import("../src/plan.js");
  const fmt = (d) => d;
  const due = copilot({ today: "2026-11-16", sp: sp(-3.3), ftse: ftse(0), items: {} });
  assert.equal(due.pullback.nextCore, null);
  const v = moneyCheckVerdict(due, { fmt });
  assert.match(v, /Due today on the plan's scheduled date.*: Second core purchase \(VWRP\)\./);
  assert.match(v, /scheduled date/);
  assert.doesNotMatch(v, /no core purchase is scheduled/);
  // A few days before, the pullback branch still leads.
  const before = moneyCheckVerdict(copilot({ today: "2026-11-12", sp: sp(-3), ftse: ftse(0), items: {} }), { fmt });
  assert.match(before, /next move is the core purchase on 2026-11-16 \(in 4 days\)/);
  // The day after: nothing left that can come forward.
  const after = moneyCheckVerdict(copilot({ today: "2026-11-17", sp: sp(-3), ftse: ftse(0), items: {} }), { fmt });
  assert.match(after, /No rule is triggered/);
  assert.match(after, /new ISA allowance/);
  // Pullback and buy tiers keep priority.
  assert.match(moneyCheckVerdict(copilot({ today: "2026-11-12", sp: sp(-5.5), ftse: ftse(0), items: {} }), { fmt }), /pullback rule has fired/);
  assert.match(moneyCheckVerdict(due, { fmt, tierHit: true }), /10% or more below its high/);
});

test("money check header names each index's price date when they differ (16 Nov: S&P to Fri, FTSE to today)", async () => {
  const { pricesAsOfLabel } = await import("../src/plan.js");
  const fmt = (d) => d.slice(5);
  assert.equal(pricesAsOfLabel({ date: "2026-11-13" }, { date: "2026-11-16" }, fmt), "S&P 500 to 11-13, FTSE 100 to 11-16");
  assert.equal(pricesAsOfLabel({ date: "2026-11-16" }, { date: "2026-11-16" }, fmt), "Prices to 11-16");
  assert.equal(pricesAsOfLabel({ date: "2026-11-13" }, null, fmt), "Prices to 11-13");
  assert.equal(pricesAsOfLabel(null, null, fmt, "2026-11-16"), "Prices to 11-16");
});

test("pullbackIdleNote: past the line with nothing to bring forward says so", async () => {
  const { pullbackIdleNote } = await import("../src/plan.js");
  const base = { nextCore: null, threshold: -5, index: "S&P 500" };
  assert.match(pullbackIdleNote({ ...base, drawdown: -5.1 }), /^S&P 500 is 5\.1% below its high, past the 5% line, but no core purchase is left to bring forward before the new ISA allowance \(6 Apr 2027\)\. The dip reserve's buy tiers start at 10% below, once fear confirms it\.$/);
  assert.equal(pullbackIdleNote({ ...base, drawdown: -2 }), "No core purchase left that can come forward before the new ISA allowance (6 Apr 2027).");
  assert.equal(pullbackIdleNote({ ...base, drawdown: null }), "No core purchase left that can come forward before the new ISA allowance (6 Apr 2027).");
  assert.equal(pullbackIdleNote({ ...base, nextCore: { date: "2027-05-03" }, drawdown: -6 }), null);
});

test("money check verdict past the 5% line with nothing to bring forward (18 Nov said 'No rule is triggered' at -6.1%)", async () => {
  const { moneyCheckVerdict } = await import("../src/plan.js");
  const fmt = (d) => d;
  const cp = copilot({ today: "2026-11-18", sp: sp(-6.1), ftse: ftse(-2.4), items: {} });
  assert.equal(cp.pullback.nextCore, null);
  const v = moneyCheckVerdict(cp, { fmt });
  assert.doesNotMatch(v, /No rule is triggered/);
  assert.match(v, /S&amp;P 500 is 6\.1% below its high, past the pullback rule's 5% line/);
  assert.match(v, /no core purchase is left to bring forward before the new ISA allowance/);
  // Inside the line, the old wording stands.
  assert.match(moneyCheckVerdict(copilot({ today: "2026-11-18", sp: sp(-3), ftse: ftse(0), items: {} }), { fmt }), /No rule is triggered/);
});

test("benchLabel: a Fair bench name says what stands between it and a good entry", async () => {
  const { benchLabel } = await import("../src/plan.js");
  // Lloyds, 19 Nov: score 77 but "Fair", which read as a contradiction beside "Good entry 73".
  assert.equal(benchLabel({ verdict: "Fair", score: 77, near: false, gaps: ["trend still down (below the 50-day, which is below the 200-day)"] }), "Fair 77 · trend still down");
  assert.equal(benchLabel({ verdict: "Fair", score: 76, near: false, gaps: ["Entry 66, needs 70", "trend still down"] }), "Fair 76 · Entry 66, needs 70; trend still down");
  // The score is already shown, so its gap says only the bar.
  assert.equal(benchLabel({ verdict: "Fair", score: 64, near: false, gaps: ["score 64, needs 72", "Entry 58, needs 70"] }), "Fair 64 · needs 72; Entry 58, needs 70");
  assert.equal(benchLabel({ verdict: "Fair", score: 71, near: true, gaps: ["score 71, needs 72"] }), "Close · score 71, needs 72");
  assert.equal(benchLabel({ verdict: "Good entry", score: 73, near: false, gaps: [] }), "Good entry 73");
  assert.equal(benchLabel({ verdict: "Avoid", score: 40, near: false, gaps: [] }), "Avoid 40");
  assert.equal(benchLabel({ verdict: null, score: null, near: false, gaps: [] }), "No data");
});

test("a confirmed buy tier is a plan action for a week (20 Nov: S&P 500 −10% confirmed, the card said nothing due)", async () => {
  const { tierEventsFrom, moneyCheckVerdict } = await import("../src/plan.js");
  const { CONFIG } = await import("../src/config.js");
  const signals = [
    { kind: "buy", date: "2026-11-20", name: "S&P 500", ticker: "S&P 500", label: "BUY · S&P 500 Correction (-10%)" },
    { kind: "buy", date: "2026-10-01", name: "FTSE 100", label: "BUY · FTSE 100 Correction (-10%)" },
    { kind: "greed", date: "2026-11-20", label: "x" },
  ];
  const ev = tierEventsFrom(signals, CONFIG.buyTiers);
  assert.deepEqual(ev.map((e) => [e.date, e.index, e.tier]), [["2026-11-20", "S&P 500", "Correction (-10%)"], ["2026-10-01", "FTSE 100", "Correction (-10%)"]]);
  assert.match(ev[0].note, /^Plan: move a third of the dip reserve into VWRP\./);
  const cp = copilot({ today: "2026-11-20", sp: sp(-11), ftse: ftse(-5.2), items: {}, tiers: ev.map((e) => e.date), tierEvents: ev });
  const a = cp.actions.find((x) => x.kind === "tier");
  assert.ok(a, "tier action listed");
  assert.equal(a.status, "go");
  assert.equal(a.title, "Buy tier confirmed: S&P 500 Correction (−10%)");
  assert.match(a.detail, /^Confirmed Fri 20 Nov, with fear confirming\. Plan: move a third of the dip reserve into VWRP\./);
  assert.equal(cp.actions.filter((x) => x.kind === "tier").length, 1, "the October tier is long past");
  assert.match(cp.headline, /^1 plan action this week/);
  assert.ok(copilotLines(cp).some((l) => /^Plan Fri 20 Nov: Buy tier confirmed: S&P 500 Correction \(−10%\)/.test(l)));
  // Still listed six days on, gone after a week.
  assert.ok(copilot({ today: "2026-11-26", sp: sp(-11), ftse: ftse(-5), items: {}, tierEvents: ev }).actions.some((x) => x.kind === "tier"));
  assert.ok(!copilot({ today: "2026-11-27", sp: sp(-11), ftse: ftse(-5), items: {}, tierEvents: ev }).actions.some((x) => x.kind === "tier"));
  // The money check leads with it, not "a tier needs fear to confirm it".
  const v = moneyCheckVerdict(cp, { fmt: (d) => d, tierHit: true });
  assert.match(v, /^<b>A buy tier is confirmed:<\/b> S&amp;P 500 Correction \(−10%\) on 2026-11-20\. Plan: move a third of the dip reserve into VWRP\./);
  assert.doesNotMatch(v, /needs fear/);
});

test("pullbackIdleNote at a buy tier points to the tiers, not 'start at 10% below'", async () => {
  const { pullbackIdleNote } = await import("../src/plan.js");
  const n = pullbackIdleNote({ nextCore: null, threshold: -5, index: "S&P 500", drawdown: -11 });
  assert.match(n, /past the 5% line, but no core purchase is left/);
  assert.match(n, /The dip reserve follows the buy tiers instead \(10% or more below, once fear confirms it\)\.$/);
});
