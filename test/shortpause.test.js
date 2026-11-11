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
