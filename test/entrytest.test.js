import { test } from "node:test";
import assert from "node:assert/strict";
import { samples, relativise, analyse, bucketOf } from "../src/entryTest.js";

// Business-day bars from a start date with a price function of the bar index.
function bars(n, price, start = "2020-01-01") {
  const out = [];
  for (let d = new Date(start + "T12:00:00Z"), i = 0; out.length < n; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const c = price(i++);
    out.push({ date: d.toISOString().slice(0, 10), high: c, close: c });
  }
  return out;
}

test("off-high buckets", () => {
  assert.equal(bucketOf(0), "0-3");
  assert.equal(bucketOf(-2.9), "0-3");
  assert.equal(bucketOf(-3), "0-3");
  assert.equal(bucketOf(-3.1), "3-10");
  assert.equal(bucketOf(-25), "20-30");
  assert.equal(bucketOf(-60), "45+");
});

test("month-end samples: off high, 12-1 momentum and forward returns", () => {
  const rows = bars(800, (i) => 100 * 1.001 ** i); // steady rise: always at the high
  const s = samples(rows, "X");
  assert.ok(s.length >= 20);
  const first = s[0];
  assert.ok(first.date.slice(0, 7) !== rows[rows.indexOf(rows.find((r) => r.date === first.date)) + 1].date.slice(0, 7), "a month-end");
  assert.ok(Math.abs(first.offHigh) < 1e-9);
  assert.ok(Math.abs(first.mom - (1.001 ** 231 - 1) * 100) < 1e-6, "12-1 momentum skips the last month");
  assert.ok(Math.abs(first.fwd6 - (1.001 ** 126 - 1) * 100) < 1e-6);
  assert.equal(s.at(-1).fwd12, null, "no 12-month return near the end");
  assert.deepEqual(samples(rows.slice(0, 200)), []);
});

test("excess returns remove the market and quintiles rank momentum per date", () => {
  const mk = (i, mom, fwd) => ({ symbol: `S${i}`, date: "2024-01-31", offHigh: -i, mom, fwd6: fwd, fwd12: fwd });
  const rel = relativise(Array.from({ length: 10 }, (_, i) => mk(i, i, 10 + i)), 5);
  assert.equal(rel.length, 10);
  assert.ok(Math.abs(rel.reduce((a, s) => a + s.ex12, 0)) < 1e-9, "excess sums to zero");
  assert.equal(rel.find((s) => s.symbol === "S0").q, 1);
  assert.equal(rel.find((s) => s.symbol === "S9").q, 5);
  assert.deepEqual(relativise([mk(1, 1, 1)], 5), [], "too few stocks that month");
  const a = analyse(rel);
  assert.equal(a.samples, 10);
  assert.equal(a.byMom.find((m) => m.q === 5).ex12.mean, 4);
  assert.equal(a.byMom.find((m) => m.q === 1).ex12.beat, 0);
});
