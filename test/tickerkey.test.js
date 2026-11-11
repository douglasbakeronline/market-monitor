import { test } from "node:test";
import assert from "node:assert/strict";
import { tickerKey, potTradeFor } from "../src/tradeLog.js";

test("tickerKey matches the scan's and Trading 212's spellings", () => {
  assert.equal(tickerKey("OTIS"), "OTIS");
  assert.equal(tickerKey("vod.l"), "VOD");
  assert.equal(tickerKey("VODl_EQ"), "VOD");
  assert.equal(tickerKey("AAPL_US_EQ"), "AAPL");
  assert.equal(tickerKey("BRK-B"), tickerKey("BRK.B"));
  assert.equal(tickerKey("BT-A.L"), tickerKey("BT.A"));
  assert.equal(tickerKey(" ttwo "), "TTWO");
  assert.equal(tickerKey(null), "");
  // A real ticker ending in L is untouched without the _EQ suffix.
  assert.equal(tickerKey("DELL"), "DELL");
  assert.equal(tickerKey("CL"), "CL");
});

test("pot trades match across spellings", () => {
  const pot = [{ ticker: "BT-A.L", entryDate: "2026-11-12", exitDate: null }];
  assert.ok(potTradeFor(pot, "BT.A", "2026-11-12", "buy"));
  assert.equal(potTradeFor(pot, "BT", "2026-11-12", "buy"), null);
});
