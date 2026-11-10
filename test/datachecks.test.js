import { test } from "node:test";
import assert from "node:assert/strict";
import { runDataChecks, dataChecksLine, checksDigestLine } from "../src/dataChecks.js";

const ok = { symbol: "AAA", ticker: "AAA", name: "Fine", market: "US", price: 90, date: "2026-11-09", pe: 20, dividendYield: 0.02, longTerm: { score: 70 }, perf: { day: 1 }, tech: { high52: 100, low52: 60, offHigh: -10 }, target: { mean: 110, analysts: 10 }, earnings: { date: "2026-12-01", days: 21 } };

test("a clean item passes every check", () => {
  const dc = runDataChecks([ok], { asOf: "2026-11-10" });
  assert.equal(dc.checked, 1);
  assert.equal(dc.flagged, 0);
  assert.equal(dataChecksLine(dc), "Data checks: all 1 items passed.");
  assert.equal(checksDigestLine(dc), null);
});

test("each fault is caught", () => {
  const bad = [
    { ...ok, symbol: "S", date: "2026-10-30" },
    { ...ok, symbol: "R", price: 120, tech: { ...ok.tech, offHigh: 20 } },
    { ...ok, symbol: "O", tech: { ...ok.tech, offHigh: -30 } },
    { ...ok, symbol: "D", perf: { day: -48 } },
    { ...ok, symbol: "Y", dividendYield: 0.22 },
    { ...ok, symbol: "UK.L", market: "UK", dividendYield: 0.0003 },
    { ...ok, symbol: "P", pe: 0.8 },
    { ...ok, symbol: "T", target: { mean: 900, analysts: 5 } },
    { ...ok, symbol: "E", earnings: { date: "2026-11-09", days: -1 } },
  ];
  const dc = runDataChecks(bad, { asOf: "2026-11-10" });
  const got = Object.fromEntries(dc.flags.map((f) => [f.symbol, f.key]));
  assert.deepEqual(got, { S: "stalePrice", R: "outsideRange", O: "offHigh", D: "bigDay", Y: "yield", "UK.L": "yield", P: "pe", T: "target", E: "pastResults" });
  assert.equal(dc.flagged, 9);
});

test("unscored trusts skip the P/E check; extras are skipped", () => {
  const dc = runDataChecks([{ ...ok, symbol: "PCT.L", pe: 1.7, longTerm: { score: null, verdict: "Investment trust" } }, { ...ok, symbol: "X", extra: true, pe: 0.1 }], { asOf: "2026-11-10" });
  assert.equal(dc.checked, 1);
  assert.equal(dc.flagged, 0);
});

test("digest names picks and list stocks first", () => {
  const dc = runDataChecks([{ ...ok, symbol: "HSBA.L", ticker: "HSBA", dividendYield: 0.3 }, { ...ok, symbol: "Q", pe: 1 }, { ...ok, symbol: "L", ticker: "L", list: true, perf: { day: 50 } }], { asOf: "2026-11-10" });
  const line = checksDigestLine(dc, ["HSBA.L"]);
  assert.match(line, /3 of 3 items flagged/);
  assert.match(line, /Check before acting: HSBA \(dividend yield looks wrong\), L \(one-day move over 35%\)\./);
  assert.match(checksDigestLine(runDataChecks([{ ...ok, symbol: "Q", pe: 1 }], { asOf: "2026-11-10" }), []), /None is a pick/);
});
