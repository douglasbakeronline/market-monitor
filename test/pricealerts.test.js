import test from "node:test";
import assert from "node:assert/strict";
import { parseAlerts, latestPrice, checkAlerts, fileWith, REARM_PCT } from "../src/priceAlerts.js";

const NOW = new Date("2026-11-09T12:00:00Z");
const P = (price, date = "2026-11-09") => ({ price, date, dayPct: null });

test("parseAlerts: object or array, both directions, invalid entries reported", () => {
  const r = parseAlerts({ alerts: [
    { symbol: "hsba.l", name: "HSBC", below: 1000, above: "1300" },
    { symbol: "META", below: 0 },
    { symbol: "bad symbol!", below: 5 },
    { symbol: "NEM", below: 120, above: 100 },
  ] });
  assert.deepEqual(r.alerts.map((a) => a.id), ["HSBA.L<1000", "HSBA.L>1300"]);
  assert.deepEqual(r.invalid.map((x) => x.reason), ["no level", "bad symbol", "below must be under above"]);
  assert.equal(parseAlerts([{ symbol: "VICI", below: 28 }]).alerts.length, 1);
  assert.deepEqual(parseAlerts(null), { alerts: [], invalid: [] });
});

test("latestPrice: stale or missing rows give null", () => {
  assert.equal(latestPrice(null, NOW), null);
  assert.equal(latestPrice([{ date: "2026-11-02", close: 10 }], NOW), null);
  assert.deepEqual(latestPrice([{ date: "2026-11-06", close: 100 }, { date: "2026-11-09", close: 95 }], NOW), { price: 95, date: "2026-11-09", dayPct: -5 });
});

test("checkAlerts: fires once, holds while beyond, re-arms after the band", () => {
  const parsed = parseAlerts([{ symbol: "VICI", name: "VICI", below: 28, note: "add a tranche" }]);
  let r = checkAlerts(parsed, { VICI: P(29) }, {}, NOW);
  assert.equal(r.alerts.length, 0);
  assert.equal(r.view[0].distPct, 3.6);
  r = checkAlerts(parsed, { VICI: P(27.9) }, r.state, NOW);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0].title, /VICI at or below 28/);
  assert.match(r.alerts[0].body, /add a tranche/);
  assert.equal(r.view[0].active, true);
  r = checkAlerts(parsed, { VICI: P(28.5) }, r.state, NOW); // back over, inside the band
  assert.equal(r.alerts.length, 0);
  r = checkAlerts(parsed, { VICI: P(27.5) }, r.state, NOW);
  assert.equal(r.alerts.length, 0, "no repeat before re-arming");
  r = checkAlerts(parsed, { VICI: P(28 * (1 + REARM_PCT / 100)) }, r.state, NOW);
  assert.equal(r.view[0].active, false);
  r = checkAlerts(parsed, { VICI: P(27) }, r.state, NOW);
  assert.equal(r.alerts.length, 1, "fires again after re-arming");
});

test("checkAlerts: above levels, and missing prices never fire or re-arm", () => {
  const parsed = parseAlerts([{ symbol: "NEM", above: 100 }]);
  let r = checkAlerts(parsed, { NEM: P(101) }, {}, NOW);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0].title, /NEM at or above 100/);
  r = checkAlerts(parsed, { NEM: null }, r.state, NOW);
  assert.equal(r.view[0].active, true);
  assert.equal(r.view[0].price, null);
  r = checkAlerts(parseAlerts([]), {}, r.state, NOW);
  assert.deepEqual(r.state, {}, "removed alerts drop their state");
});

test("fileWith: rebuilds entries, replaces a level, removes a symbol", () => {
  const view = checkAlerts(parseAlerts([{ symbol: "HSBA.L", name: "HSBC", below: 1000, above: 1300, note: "n" }, { symbol: "VICI", below: 28 }]), {}, {}, NOW).view;
  assert.deepEqual(fileWith(view), [{ symbol: "HSBA.L", name: "HSBC", below: 1000, above: 1300, note: "n" }, { symbol: "VICI", below: 28 }]);
  assert.deepEqual(fileWith(view, { symbol: "vici", dir: "below", level: "27.5" }, "HSBA.L"), [{ symbol: "VICI", below: 27.5 }]);
  const round = parseAlerts(fileWith(view, { symbol: "NEM", dir: "above", level: 120, note: "trim check" }));
  assert.deepEqual(round.alerts.map((a) => a.id), ["HSBA.L<1000", "HSBA.L>1300", "VICI<28", "NEM>120"]);
  assert.equal(round.invalid.length, 0);
});

test("digestLine: reached and closest armed alerts", async () => {
  const { digestLine } = await import("../src/priceAlerts.js");
  assert.equal(digestLine([]), null);
  const parsed = parseAlerts([{ symbol: "VICI", name: "VICI", below: 24 }, { symbol: "NEM", above: 130 }, { symbol: "META", below: 300 }, { symbol: "HSBA.L", name: "HSBC", below: 1400 }]);
  const r = checkAlerts(parsed, { VICI: P(24.8), NEM: P(121), META: P(600), "HSBA.L": P(1320) }, {}, NOW);
  assert.equal(digestLine(r.view), "Price alerts reached: HSBC below 1400; closest: VICI below 24.0 (3.3% to go), NEM above 130 (6.9% to go).");
  const quiet = checkAlerts(parseAlerts([{ symbol: "META", below: 300 }]), { META: P(600) }, {}, NOW);
  assert.equal(digestLine(quiet.view), "Price alerts: 1 set, none within 10% of its level.");
});
