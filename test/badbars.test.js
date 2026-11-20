import { test } from "node:test";
import assert from "node:assert/strict";
import { dropBadBars, parseYahoo } from "../src/data/prices.js";

const bars = (closes, vols) => closes.map((c, i) => ({ date: `2026-05-${String(i + 1).padStart(2, "0")}`, open: c, high: c, low: c, close: c, volume: vols?.[i] ?? 100 }));

test("dropBadBars drops a last bar seven times the previous close on normal volume (SanDisk, 19 Nov)", () => {
  const rows = bars([100, 98, 97, 755], [100, 100, 100, 116]);
  const out = dropBadBars(rows);
  assert.deepEqual(out.map((b) => b.date), ["2026-05-04"]);
  assert.deepEqual(rows.map((r) => r.close), [100, 98, 97]);
});

test("dropBadBars drops an interior spike that reverts the next day, either way", () => {
  const up = bars([100, 101, 450, 102]);
  assert.equal(dropBadBars(up).length, 1);
  assert.deepEqual(up.map((r) => r.close), [100, 101, 102]);
  const down = bars([100, 101, 20, 102]);
  assert.equal(dropBadBars(down).length, 1);
  assert.deepEqual(down.map((r) => r.close), [100, 101, 102]);
});

test("dropBadBars keeps real moves: heavy volume, a level that holds, or under 3x", () => {
  const crash = bars([100, 100, 100, 25], [100, 100, 100, 2000]);
  assert.equal(dropBadBars(crash).length, 0, "a collapse on 20x volume is real news");
  const shift = bars([100, 100, 25, 26, 25]);
  assert.equal(dropBadBars(shift).length, 0, "a level that holds (an unflagged split) is not a spike");
  const takeover = bars([100, 100, 190], [100, 100, 120]);
  assert.equal(dropBadBars(takeover).length, 0, "+90% is under the 3x bar");
  assert.equal(dropBadBars(bars([100])).length, 0);
  assert.equal(dropBadBars([]).length, 0);
});

test("dropBadBars with no volume (indices) relies on the size of the move", () => {
  const vix = bars([20, 21, 90], [0, 0, 0]);
  assert.equal(dropBadBars(vix).length, 1);
  const real = bars([20, 21, 45], [0, 0, 0]);
  assert.equal(dropBadBars(real).length, 0);
});

test("parseYahoo drops a bad live quote and no longer calls the series live", () => {
  const ts = (d) => Date.parse(`2026-11-${d}T15:00:00Z`) / 1000;
  const res = {
    meta: { exchangeTimezoneName: "America/New_York", symbol: "SNDK", regularMarketPrice: 755.16, regularMarketTime: ts("19") + 3600 },
    timestamp: [ts("16"), ts("17"), ts("18"), ts("19")],
    indicators: { quote: [{ close: [98, 97, 96.5, 97], open: [98, 97, 96.5, 97], high: [99, 98, 97, 98], low: [97, 96, 96, 96], volume: [100, 100, 100, 110] }] },
  };
  const warn = console.warn; let said = ""; console.warn = (m) => { said += m; };
  const out = parseYahoo(res);
  console.warn = warn;
  assert.equal(out.rows.at(-1).date, "2026-11-18");
  assert.equal(out.rows.at(-1).close, 96.5);
  assert.equal(out.live, false);
  assert.deepEqual(out.badBars, [{ date: "2026-11-19", close: 755.16, prev: 96.5 }]);
  assert.match(said, /Bad bar guard: dropped 2026-11-19 \(755\.16 after 96\.5\) for SNDK/);
});
