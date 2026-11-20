import test from "node:test";
import assert from "node:assert/strict";
import { parseAlerts, latestPrice, checkAlerts, fileWith, toGo, withReached, digestLine, REARM_PCT, followUp, followUpDue, afterText } from "../src/priceAlerts.js";

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
  assert.match(r.alerts[0].title, /VICI at or below 28$/);
  assert.match(r.alerts[0].body, /alert level was 28\./);
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
  assert.equal(digestLine(r.view), "Price alerts reached: HSBC below 1400; closest: VICI below 24 (3.2% to go), NEM above 130 (7.4% to go).");
  const quiet = checkAlerts(parseAlerts([{ symbol: "META", below: 300 }]), { META: P(600) }, {}, NOW);
  assert.equal(digestLine(quiet.view), "Price alerts: 1 set, none within 10% of its level.");
});

test("toGo: the move still needed from today's price, not from the level", () => {
  // ANT at 96.7 (19 Nov): a fall of 6.9% reaches 90, a rise of 15.8% reaches 112.
  assert.equal(toGo({ dir: "below", level: 90, price: 96.7 }), 6.9);
  assert.equal(toGo({ dir: "above", level: 112, price: 96.7 }), 15.8);
  assert.equal(toGo({ dir: "below", level: 100, price: 95 }), -5.3, "past the level reads negative");
  assert.equal(toGo({ dir: "below", level: 90, price: null }), null);
});

test("fileWith: staged tiers for one stock stay separate entries", () => {
  const file = [
    { symbol: "ANT", name: "Anthropic", below: 90, above: 112, note: "tier 1" },
    { symbol: "ANT", name: "Anthropic", below: 85, note: "tier 2" },
    { symbol: "ANT", name: "Anthropic", below: 83, note: "tier 3" },
    { symbol: "VICI", below: 28 },
  ];
  const view = checkAlerts(parseAlerts(file), {}, {}, NOW).view;
  assert.deepEqual(fileWith(view), file, "round trip keeps every tier and note");
  // A level that matches an existing tier updates that tier's note only.
  const upd = fileWith(view, { symbol: "ANT", dir: "below", level: 85, note: "tier 2, steadied" });
  assert.deepEqual(upd.filter((e) => e.symbol === "ANT").map((e) => [e.below, e.note]), [[90, "tier 1"], [85, "tier 2, steadied"], [83, "tier 3"]]);
  // A new level where tiers exist is added as another tier.
  const add = parseAlerts(fileWith(view, { symbol: "ANT", dir: "below", level: 80, note: "tier 4" }));
  assert.deepEqual(add.alerts.map((a) => a.id), ["ANT<90", "ANT>112", "ANT<85", "ANT<83", "ANT<80", "VICI<28"]);
  // One level in that direction is still replaced, as before.
  const rep = parseAlerts(fileWith(view, { symbol: "ANT", dir: "above", level: 120 }));
  assert.deepEqual(rep.alerts.map((a) => a.id), ["ANT<90", "ANT>120", "ANT<85", "ANT<83", "VICI<28"]);
  assert.deepEqual(fileWith(view, null, "ANT"), [{ symbol: "VICI", below: 28 }]);
  // Two entries with different notes are not merged even if their directions fit.
  const two = checkAlerts(parseAlerts([{ symbol: "X", below: 10, note: "a" }, { symbol: "X", above: 20, note: "b" }]), {}, {}, NOW).view;
  assert.equal(fileWith(two).length, 2);
});

test("withReached: fires are logged and survive re-arming; the view says when and how far since", () => {
  const parsed = parseAlerts([{ symbol: "ANT", name: "Anthropic", below: 90 }, { symbol: "ANT", below: 85 }]);
  const T1 = new Date("2026-11-20T15:00:00Z"), T2 = new Date("2026-11-24T15:00:00Z");
  let r = checkAlerts(parsed, { ANT: P(89, "2026-11-20") }, {}, T1);
  assert.deepEqual(r.fired, [{ id: "ANT<90", symbol: "ANT", dir: "below", level: 90, price: 89, at: T1.toISOString() }]);
  let log = withReached([], r.fired);
  assert.equal(log.length, 1);
  // Re-armed at 93 (3%+ back over 90): state forgets, the log does not.
  r = checkAlerts(parsed, { ANT: P(93, "2026-11-24") }, r.state, T2);
  assert.equal(r.view[0].active, false);
  log = withReached(log, r.fired);
  const v = withReached.view(r.view, log);
  assert.deepEqual([v[0].lastAt, v[0].lastPrice, v[0].sincePct], ["2026-11-20", 89, 4.5]);
  assert.equal(v[1].lastAt, null, "a level never reached has no history");
  // Cap keeps the newest.
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `X<${i}`, symbol: "X", dir: "below", level: i, price: i, at: T1.toISOString() }));
  assert.equal(withReached(log, many).length, 40);
  assert.equal(withReached(log, many).at(-1).id, "X<49");
  assert.deepEqual(withReached(null, []), []);
});

test("digestLine: a reached level says when and the move since", () => {
  const view = withReached.view([{ id: "ANT<90", symbol: "ANT", name: "Anthropic", dir: "below", level: 90, price: 92, active: true }],
    [{ id: "ANT<90", symbol: "ANT", dir: "below", level: 90, price: 88, at: "2026-11-20T15:00:00Z" }]);
  assert.equal(digestLine(view), "Price alerts reached: Anthropic below 90 (20 Nov at 88.0, +4.5% since).");
});

test("digestLine: no 'since' while the price is where it fired", () => {
  const view = [{ id: "A<9", symbol: "A", dir: "below", level: 9, price: 8, active: true, lastAt: "2026-11-19", lastPrice: 8, sincePct: 0 }];
  assert.equal(digestLine(view), "Price alerts reached: A below 9 (19 Nov at 8.00).");
});

test("checkAlerts: a level firing again says when it was last reached", () => {
  const parsed = parseAlerts([{ symbol: "VICI", below: 28 }]);
  const log = [{ id: "VICI<28", symbol: "VICI", dir: "below", level: 28, price: 27.6, at: "2026-11-02T15:00:00Z" }];
  const r = checkAlerts(parsed, { VICI: P(27.9) }, {}, NOW, log);
  assert.match(r.alerts[0].body, /Last reached 2 Nov at 27\.6\./);
  assert.doesNotMatch(checkAlerts(parsed, { VICI: P(27.9) }, {}, NOW).alerts[0].body, /Last reached/);
});

// Sessions from 16 Nov 2026 (weekdays only), closes rising 1 a day from 100.
const sessions = (n, from = "2026-11-16", start = 100, step = 1) => {
  const out = []; let d = new Date(`${from}T00:00:00Z`);
  while (out.length < n) { const w = d.getUTCDay(); if (w && w < 6) out.push({ date: d.toISOString().slice(0, 10), close: start + step * out.length }); d = new Date(d.getTime() + 864e5); }
  return out;
};

test("followUp: the move 1 week and 1 month after a fire, against the home index", () => {
  const fire = { id: "ANT<90", symbol: "ANT", dir: "below", level: 90, price: 89, at: "2026-11-20T15:00:00Z" };
  const lse = { id: "HSBA.L<1000", symbol: "HSBA.L", dir: "below", level: 1000, price: 990, at: "2026-11-20T09:00:00Z" };
  // Not due on the day: nothing to fetch.
  assert.deepEqual(followUpDue([fire], new Date("2026-11-24T12:00:00Z")), []);
  assert.deepEqual(followUpDue([fire, lse], new Date("2026-11-30T12:00:00Z")), ["ANT", "HSBA.L"]);
  const rows = { ANT: sessions(30, "2026-11-16", 90, -0.5), "HSBA.L": sessions(30, "2026-11-16", 990, 0) };
  const idx = { US: sessions(30, "2026-11-16", 6000, 6), UK: sessions(30, "2026-11-16", 9000, 0) };
  // Fire on Fri 20 Nov (row 4). 5 sessions on: Fri 27 Nov, row 9, close 85.5; S&P 6030 to 6060.
  let log = followUp([fire, lse], rows, idx);
  assert.deepEqual(log[0].after.w1, { date: "2026-11-27", pct: -3.9, idx: 0.5 });
  assert.equal(log[1].after.w1.idx, 0, "a London stock is measured against the FTSE 100");
  // 21 sessions on: Mon 21 Dec (row 25), close 77.5.
  assert.deepEqual(log[0].after.m1, { date: "2026-12-21", pct: -12.9, idx: 2.1 });
  // Short rows: only what exists is filled, and a filled figure is kept.
  const short = followUp([fire], { ANT: rows.ANT.slice(0, 12) }, idx);
  assert.ok(short[0].after.w1 && !short[0].after.m1);
  assert.deepEqual(followUp(short, {}, {})[0].after.w1, short[0].after.w1);
  // Done entries are not fetched again; no index means no comparison.
  assert.deepEqual(followUpDue(log, new Date("2027-01-30T12:00:00Z")), []);
  assert.equal(followUp([fire], rows, {})[0].after.w1.idx, null);
  // A bar dated today may be part-day: it waits.
  assert.equal(followUp([fire], rows, idx, "2026-11-27")[0].after, undefined);
  assert.ok(followUp([fire], rows, idx, "2026-11-28")[0].after.w1);
  assert.deepEqual(followUp(null, rows, idx), []);
  // The view carries the latest fire's figures; the card's line.
  const v = withReached.view([{ id: "ANT<90", price: 80 }], log);
  assert.deepEqual(v[0].after, log[0].after);
  assert.equal(afterText(log[0].after, "US"), "After it: \u22123.9% in a week (S&P 500 +0.5%), \u221212.9% in a month (S&P 500 +2.1%).");
  assert.equal(afterText(short[0].after, "US"), "After it: \u22123.9% in a week (S&P 500 +0.5%).");
  assert.equal(afterText({ w1: { pct: 2, idx: null } }, "UK"), "After it: +2% in a week.");
  assert.equal(afterText(null), null);
});
