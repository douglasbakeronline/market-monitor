import { test } from "node:test";
import assert from "node:assert/strict";
import { topUpToTarget, monthsOfTopUps, pickSizes, pickSizeLine, rebalancesInYear, digestLine } from "../src/rebalance.js";

const T = { core: 70, reserve: 15, picks: 15, swing: 0 };

test("topUpToTarget fills under-target pots without selling", () => {
  // Core overweight: 8000 / 0.7 = 11429 new total.
  const r = topUpToTarget({ core: 8000, reserve: 1000, picks: 1000 }, T);
  assert.equal(r.total, 10000);
  assert.equal(Math.round(r.newTotal), 11429);
  assert.deepEqual(r.split, { reserve: 714, picks: 714 });
  assert.equal(r.newMoney, 1428);
  assert.equal(r.onTarget, false);
});

test("topUpToTarget: on target needs nothing; swing ignored; empty is null", () => {
  const r = topUpToTarget({ core: 7000, reserve: 1500, picks: 1500, swing: 500 }, T);
  assert.equal(r.newMoney, 0);
  assert.equal(r.onTarget, true);
  assert.equal(topUpToTarget({}, T), null);
  assert.equal(topUpToTarget({ core: -5, picks: NaN }, T), null);
});

test("topUpToTarget after a dip spends the reserve", () => {
  const r = topUpToTarget({ core: 7500, reserve: 0, picks: 1500 }, T);
  assert.deepEqual(Object.keys(r.split).sort(), ["picks", "reserve"]);
  assert.equal(r.split.reserve, Math.round(0.15 * 7500 / 0.7));
});

test("monthsOfTopUps", () => {
  assert.equal(monthsOfTopUps(1428, 500), 3);
  assert.equal(monthsOfTopUps(0, 500), 0);
  assert.equal(monthsOfTopUps(100, 0), null);
});

test("pickSizes nets buys and sells per pick, at cost", () => {
  const tr = [
    { pot: "picks", ticker: "HSBA", action: "buy", amount: 200 },
    { pot: "picks", ticker: "HSBA", action: "buy", amount: 100 },
    { pot: "picks", ticker: "META", action: "buy", amount: 600 },
    { pot: "picks", ticker: "NEM", action: "buy", amount: 100 },
    { pot: "picks", ticker: "NEM", action: "sell", amount: 100 },
    { pot: "core", ticker: "VWRP", action: "buy", amount: 5000 },
    { pot: "picks", ticker: "VICI", action: "buy", amount: null },
  ];
  const s = pickSizes(tr, 10000);
  assert.deepEqual(s.map((x) => [x.ticker, x.status]), [["META", "ceiling"], ["HSBA", "full"]]);
  assert.match(pickSizeLine(s), /^Past the 5% ceiling: META 6\.0%\. The rule says trim back to 3%\.$/);
  assert.match(pickSizeLine(s.slice(1)), /At the 3% maximum, so no further tranches: HSBA 3\.0%/);
  assert.match(pickSizeLine(pickSizes([{ pot: "picks", ticker: "STZ", action: "buy", amount: 150 }], 10000)), /below the 3% maximum \(largest STZ 1\.5%\)/);
  assert.deepEqual(pickSizes(tr, 0), []);
  assert.equal(pickSizeLine([]), null);
});

test("rebalancesInYear counts distinct rebalance days in the last 365", () => {
  const tr = [
    { rule: "rebalance", date: "2026-03-01" },
    { rule: "rebalance", date: "2026-03-01" },
    { rule: "rebalance", date: "2025-11-01" },
    { rule: "rebalance", date: "2026-09-10" },
    { rule: "core", date: "2026-09-10" },
  ];
  assert.equal(rebalancesInYear(tr, "2026-11-10"), 2);
  assert.equal(rebalancesInYear([], "2026-11-10"), 0);
});

test("digestLine states the agreed rule", () => {
  assert.match(digestLine(), /5\+ points off target \(otherwise at most twice a year\).*past 5% of the portfolio back to 3%\.$/);
});

test("coreEstimate scales the core pot by VWRP's move since saving", async () => {
  const { coreEstimate } = await import("../src/rebalance.js");
  const pf = { core: 7000, reserve: 1500, vwrpAt: { level: 140, date: "2026-11-09" } };
  const e = coreEstimate(pf, { level: 147, date: "2026-11-16" });
  assert.equal(e.value, 7350);
  assert.equal(e.pct.toFixed(1), "5.0");
  assert.equal(e.since, "2026-11-09");
  assert.equal(coreEstimate(pf, { level: 147, date: "2026-11-09" }), null, "same day: nothing to do");
  assert.equal(coreEstimate({ core: 7000 }, { level: 147, date: "2026-11-16" }), null, "older saves have no VWRP level");
  assert.equal(coreEstimate(pf, null), null);
  assert.equal(coreEstimate({ ...pf, core: 0 }, { level: 147, date: "2026-11-16" }), null);
});

test("lookThrough adds a pick to its weight inside the core fund", async () => {
  const { lookThrough } = await import("../src/rebalance.js");
  const hold = [{ symbol: "NVDA", name: "Nvidia", weight: 4.5 }, { symbol: "META", name: "Meta", weight: 1.2 }];
  const r = lookThrough(70, hold, [{ ticker: "META", pct: 2 }, { ticker: "HSBA", pct: 1 }], { HSBA: "HSBC" });
  assert.deepEqual(r.map((x) => [x.ticker, x.pct.toFixed(2)]), [["NVDA", "3.15"], ["META", "2.84"], ["HSBA", "1.00"]]);
  assert.equal(r[1].core.toFixed(2), "0.84");
  assert.equal(r[2].name, "HSBC");
});
