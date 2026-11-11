import { test } from "node:test";
import assert from "node:assert/strict";
import { newPlanBook, stepPlanBook, stepVariant, newPlanVariant, planSummary, variantValue } from "../src/planBook.js";

const ctx = (o) => ({ date: "2026-11-16", vwrp: 100, prices: { META: { close: 600, market: "US" }, "HSBA.L": { close: 1300, market: "UK" } }, checks: { META: { ok: true, ticker: "META" }, "HSBA.L": { ok: true, tone: "watch", ticker: "HSBA" } }, tier: 0, ...o });

test("nothing happens before the start date", () => {
  const b = stepPlanBook(newPlanBook(), ctx({ date: "2026-11-13" }));
  assert.equal(b.variants.agreed.started, null);
  assert.equal(b.variants.agreed.value, 10000);
});

test("day one: 70% VWRP, tranches where the check passes; weakHold skips the flagged pick", () => {
  const b = stepPlanBook(newPlanBook(), ctx());
  const a = b.variants.agreed, w = b.variants.weakHold, all = b.variants.vwrp;
  assert.equal(a.core, 7000);
  assert.equal(a.reserve, 1500);
  assert.deepEqual(Object.keys(a.picks).sort(), ["HSBA.L", "META"]);
  assert.equal(a.picks.META.cost, 100);
  assert.equal(a.picks.META.value, 99.85, "0.15% FX");
  assert.equal(a.picks["HSBA.L"].value, 99.5, "0.5% stamp duty");
  assert.deepEqual(Object.keys(w.picks), ["META"]);
  assert.equal(all.core, 10000);
  assert.equal(all.picksCash, 0);
});

test("one tranche a month, marks to prices, and the summary compares with VWRP", () => {
  let b = stepPlanBook(newPlanBook(), ctx());
  b = stepPlanBook(b, ctx({ date: "2026-11-17", vwrp: 110, prices: { META: { close: 660, market: "US" }, "HSBA.L": { close: 1300, market: "UK" } } }));
  const a = b.variants.agreed;
  assert.equal(a.picks.META.tranches, 1, "no second tranche in November");
  assert.equal(a.core, 7700);
  assert.equal(a.picks.META.value, 109.84);
  const s = planSummary(b);
  assert.equal(s.length, 3);
  assert.equal(s.find((x) => x.key === "vwrp").returnPct, 10);
  assert.ok(s.find((x) => x.key === "agreed").vsVwrp < 0, "cash drags in a rising month");
  b = stepPlanBook(b, ctx({ date: "2026-12-01", vwrp: 110, prices: { META: { close: 660, market: "US" }, "HSBA.L": { close: 1300, market: "UK" } } }));
  assert.equal(b.variants.agreed.picks.META.tranches, 2, "December tranche");
});

test("buy tiers deploy a third of the reserve; the drip waits 30 days after a tier", () => {
  let v = stepVariant(newPlanVariant("agreed"), ctx({ checks: {} }));
  v = stepVariant(v, ctx({ date: "2026-11-20", tier: -10, checks: {} }));
  assert.equal(v.reserve, 1000);
  v = stepVariant(v, ctx({ date: "2026-11-23", tier: -10, checks: {} }));
  assert.equal(v.reserve, 1000, "same tier: nothing more");
  v = stepVariant(v, ctx({ date: "2026-12-07", tier: -10, checks: {} }));
  assert.equal(v.reserve, 1000, "drip skipped after a recent tier");
  assert.match(v.log.at(-1).what, /skipped/);
  v = stepVariant(v, ctx({ date: "2027-01-04", tier: 0, checks: {} }));
  assert.ok(Math.abs(v.reserve - 1000 * 5 / 6) < 0.01, "January drip: a sixth");
  assert.ok(Math.abs(variantValue(v) - 10000) < 0.02);
});

test("a pick over 5% is trimmed back to 3%", () => {
  let v = stepVariant(newPlanVariant("agreed"), ctx());
  v = stepVariant(v, ctx({ date: "2026-11-18", prices: { META: { close: 4000, market: "US" }, "HSBA.L": { close: 1300, market: "UK" } } }));
  const book = variantValue(v);
  assert.ok(v.picks.META.value <= book * 0.031);
  assert.match(v.log.map((x) => x.what).join(), /Trimmed META/);
});
