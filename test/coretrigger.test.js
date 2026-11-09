import { test } from "node:test";
import assert from "node:assert/strict";
import { ddByDate, priorLookup, toGbp, monthStarts, simulate, agreement } from "../src/coreTrigger.js";

// Daily rows over consecutive calendar days from 2020-01-01.
const rowsOf = (closes) => closes.map((close, i) => ({ date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), close }));

test("prior lookup only sees values from earlier dates", () => {
  const look = priorLookup([["2020-01-02", -1], ["2020-01-04", -6]]);
  assert.equal(look("2020-01-02"), null);
  assert.equal(look("2020-01-03"), -1);
  assert.equal(look("2020-01-04"), -1, "same-day value is not known yet");
  assert.equal(look("2020-01-05"), -6);
});

test("toGbp divides by dollars per pound on shared dates", () => {
  const usd = [{ date: "a", close: 130 }, { date: "b", close: 100 }];
  assert.deepEqual(toGbp(usd, [{ date: "a", close: 1.3 }]), [{ date: "a", close: 100 }]);
});

test("month starts follow the calendar", () => {
  const rows = rowsOf(Array(70).fill(1));
  assert.deepEqual(monthStarts(rows, "2020-02-01").map((i) => rows[i].date), ["2020-02-01", "2020-03-01"]);
});

test("simulate brings a purchase forward on the first day after a trigger", () => {
  // Flat for a year, then a 6% fall mid-January 2021 in the signal only.
  const n = 420;
  const asset = rowsOf(Array.from({ length: n }, (_, i) => 100 + (i > 380 ? 5 : 0)));
  const sig = rowsOf(Array.from({ length: n }, (_, i) => (i >= 380 && i < 385 ? 94 : 100)));
  const r = simulate(asset, { sig: ddByDate(sig), own: ddByDate(asset) }, { from: "2021-01-01", threshold: -5 });
  const s = r.sources.sig;
  assert.equal(s.months, 1, "Jan to Feb 2021");
  assert.equal(s.fired, 1);
  // Signal fell at index 380 (2021-01-15); known from the next day, 381, when price is already 105.
  assert.equal(s.whenFired.median, 0);
  assert.equal(r.sources.own.fired, 0, "the asset itself never fell");
  assert.deepEqual(agreement(r.firedBy, "sig", "own", 1), { both: 0, only_sig: 1, only_own: 0, neither: 0 });
});

test("an early buy before a rise saves money", () => {
  const n = 440;
  // Asset rises 10% during February 2021; signal is 6% down all the time after day 300.
  const asset = rowsOf(Array.from({ length: n }, (_, i) => (i < 410 ? 100 : 110)));
  const sig = rowsOf(Array.from({ length: n }, (_, i) => (i < 300 ? 100 : 94)));
  const r = simulate(asset, { sig: ddByDate(sig) }, { from: "2021-02-01", threshold: -5 });
  assert.equal(r.sources.sig.fired, 1);
  assert.equal(r.sources.sig.whenFired.median, 10);
  assert.equal(r.sources.sig.perPurchase, 10);
});
