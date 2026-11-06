import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustSplits, parseYahoo } from "../src/data/prices.js";

const bars = (closes) => closes.map((c, i) => ({ date: `2026-05-${String(i + 1).padStart(2, "0")}`, open: c, high: c, low: c, close: c, volume: 100 }));

test("adjustSplits rescales bars still on the pre-split basis", () => {
  const rows = bars([1000, 1010, 1020, 102, 104]);
  const done = adjustSplits(rows, [{ date: "2026-05-04", ratio: 10 }]);
  assert.equal(done.length, 1);
  assert.deepEqual(rows.map((r) => r.close), [100, 101, 102, 102, 104]);
  assert.equal(rows[0].volume, 1000);
});

test("adjustSplits leaves already-adjusted bars alone (and real crashes)", () => {
  const rows = bars([100, 101, 102, 102, 104]);
  assert.equal(adjustSplits(rows, [{ date: "2026-05-04", ratio: 10 }]).length, 0);
  assert.equal(rows[0].close, 100);
  const crash = bars([100, 100, 45, 44]);
  assert.equal(adjustSplits(crash, [{ date: "2026-05-03", ratio: 10 }]).length, 0, "a 55% fall is not a 10:1 split");
  assert.equal(adjustSplits(bars([100, 100]), []).length, 0);
});

test("parseYahoo reads split events and applies the guard", () => {
  const ts = (d) => Date.parse(`2026-05-${d}T14:30:00Z`) / 1000;
  const res = {
    meta: { exchangeTimezoneName: "America/New_York", symbol: "KLAC" },
    timestamp: [ts("01"), ts("04"), ts("05")],
    indicators: { quote: [{ close: [1000, 101, 103], open: [1000, 100, 102], high: [1000, 101, 103], low: [1000, 100, 102], volume: [1, 10, 10] }] },
    events: { splits: { [ts("04")]: { date: ts("04"), numerator: 10, denominator: 1, splitRatio: "10:1" } } },
  };
  const warn = console.warn; console.warn = () => {};
  const out = parseYahoo(res);
  console.warn = warn;
  assert.deepEqual(out.splits, [{ date: "2026-05-04", ratio: 10 }]);
  assert.equal(out.rows[0].close, 100);
});
