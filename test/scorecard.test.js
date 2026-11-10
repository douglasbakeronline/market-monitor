import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCloses, closeOn, picksVsCore, scorecardLine } from "../src/scorecard.js";

test("closes merge in date order and look back over weekends only", () => {
  const m = mergeCloses({ "2026-11-06": 100 }, [{ date: "2026-11-09", close: 101.234 }, { date: "2026-11-05", close: 99 }, { date: "bad", close: 1 }, { date: "2026-11-10", close: NaN }]);
  assert.deepEqual(Object.keys(m), ["2026-11-05", "2026-11-06", "2026-11-09"]);
  assert.equal(m["2026-11-09"], 101.23);
  assert.equal(closeOn(m, "2026-11-08"), 100);
  assert.equal(closeOn(m, "2026-11-04"), null);
  assert.equal(closeOn(m, "2026-12-01"), null, "a long gap is not papered over");
});

test("picks vs the same money in VWRP", () => {
  const closes = { "2026-01-05": 100, "2026-06-01": 110, "2026-11-10": 120 };
  const prices = { HSBA: 1200, META: 500 };
  const trades = [
    { date: "2026-01-05", pot: "picks", action: "buy", ticker: "HSBA.L", amount: 1000, price: 1000 }, // +20%; VWRP +20%
    { date: "2026-06-01", pot: "picks", action: "buy", ticker: "META", amount: 1100, price: 550 }, // -9.1%; VWRP +9.1%
    { date: "2026-06-01", pot: "picks", action: "buy", ticker: "NEM", amount: 500 }, // no price paid: skipped
    { date: "2026-06-01", pot: "core", action: "buy", ticker: "VWRP", amount: 5000, price: 110 }, // not a pick
  ];
  const sc = picksVsCore(trades, closes, prices);
  assert.equal(sc.counted, 2);
  assert.equal(sc.skipped, 1);
  assert.equal(sc.paid, 2100);
  assert.equal(sc.picks, 2200);
  assert.equal(sc.core, 2400);
  assert.equal(sc.gap, -200);
  assert.equal(sc.since, "2026-01-05");
  assert.deepEqual(sc.rows.map((r) => [r.ticker, r.gap]), [["HSBA.L", 0], ["META", -200]]);
  assert.match(scorecardLine(sc), /behind by £200/);
});

test("a sale takes the same pounds out of the VWRP shadow", () => {
  const closes = { "2026-01-05": 100, "2026-06-01": 200, "2026-11-10": 200 };
  const trades = [
    { date: "2026-01-05", pot: "picks", action: "buy", ticker: "X", amount: 1000, price: 10 }, // 100 shares
    { date: "2026-06-01", pot: "picks", action: "sell", ticker: "X", amount: 1000, price: 20 }, // 50 shares sold
  ];
  const sc = picksVsCore(trades, closes, { X: 20 });
  // Picks: 50 shares at 20 = 1000. VWRP: 10 units bought, 5 sold, 5 x 200 = 1000.
  assert.equal(sc.picks, 1000);
  assert.equal(sc.core, 1000);
  assert.equal(sc.gap, 0);
});

test("nothing to compare", () => {
  assert.equal(picksVsCore([], {}, {}), null);
  assert.deepEqual(picksVsCore([{ date: "2026-01-05", pot: "picks", action: "buy", ticker: "X", amount: 10 }], { "2026-01-05": 1 }, {}), { counted: 0, skipped: 1 });
  assert.equal(scorecardLine({ counted: 0 }), null);
});
