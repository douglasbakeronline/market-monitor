import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, greedProxy, vs200, trimEpisodes, maxDrawdownAhead, trimForward, trimSim, trimRolling, corr } from "../src/trimBacktest.js";

const day = (i) => { const m = Math.floor(i / 21); return `${2000 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-${String((i % 21) + 1).padStart(2, "0")}`; };

// Flat at 100 for 400 bars, a 30-bar rally to 130, flat at 130, then back to 100 and flat.
const rally = () => {
  const c = Array(400).fill(100);
  for (let k = 1; k <= 30; k++) c.push(100 + k);
  for (let k = 0; k < 100; k++) c.push(130);
  for (let k = 1; k <= 30; k++) c.push(130 - k);
  return c.concat(Array(400).fill(100)).map((close, i) => ({ date: day(i), close, vix: 12 }));
};

test("sma and vs200", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const rows = rally();
  const a = vs200(rows);
  assert.equal(a[199], 0);
  assert.ok(a[430] > 10, "well above the 200-day after the rally");
});

test("trim episodes fire once and re-arm on the score", () => {
  const rows = rally();
  // Greed high from bar 420 to 540, then falls to 50.
  rows.forEach((r, i) => { r.fg = i >= 420 && i < 540 ? 85 : 50; });
  const s = trimEpisodes(rows);
  assert.equal(s.length, 1);
  assert.ok(s[0] >= 420 && s[0] <= 430, `fires once the rally clears +10%: ${s[0]}`);
  // A second greedy spell after re-arming, but the trend is flat: no new episode.
  rows.forEach((r, i) => { if (i >= 800 && i < 820) r.fg = 90; });
  assert.equal(trimEpisodes(rows).length, 1);
  // VIX too high blocks it.
  rows.forEach((r) => { r.vix = 20; });
  assert.equal(trimEpisodes(rows).length, 0);
  // Price and VIX only (no sentiment): fires on the trend alone.
  rows.forEach((r) => { r.vix = 12; r.fg = null; });
  assert.equal(trimEpisodes(rows, { useFg: false }).length, 1);
  assert.equal(trimEpisodes(rows).length, 0, "no F&G, no full-rule episode");
});

test("drawdown ahead and forward stats", () => {
  const rows = rally();
  assert.equal(Math.round(maxDrawdownAhead(rows, 500)), -23, "130 to 100");
  assert.equal(maxDrawdownAhead(rows, rows.length - 10), null);
  const f = trimForward(rows, [500]);
  assert.equal(f.episodes, 1);
  assert.equal(f.atSignal.fall10in1y, 100);
  assert.ok(f.atSignal.y1.median < 0);
});

test("trim sim: selling before a fall and buying back lower beats holding", () => {
  const rows = rally();
  const r = trimSim(rows, [500], 300, 950, { frac: 0.1, holdBars: 100 });
  assert.equal(r.trades, 1);
  assert.ok(r.vsHold > 0, `${r.vsHold}`);
  // Selling at the start of a rally and buying back at the top loses.
  const bad = trimSim(rows, [400], 300, 950, { frac: 0.1, holdBars: 30 });
  assert.ok(bad.vsHold < 0);
  // Buy back early when the price drops under the 200-day.
  const early = trimSim(rows, [500], 300, 950, { frac: 0.1, holdBars: 400, backBelow200: true });
  assert.ok(early.vsHold > 0);
  const roll = trimRolling(rows, [500], { a: { frac: 0.1 } }, { years: 1, warm: 252 });
  assert.ok(roll.a.windows > 0);
});

test("greed proxy is high after a calm rally and low after a fall", () => {
  const rows = [];
  let p = 100;
  for (let i = 0; i < 1200; i++) {
    p *= 1 + Math.sin(i / 40) * 0.004;
    rows.push({ date: day(i), close: p, vix: 20 - Math.sin(i / 40) * 5 });
  }
  const g = greedProxy(rows);
  assert.equal(g[100], null);
  const ok = g.filter((x) => x != null);
  assert.ok(ok.every((x) => x >= 0 && x <= 100));
  assert.ok(Math.max(...ok) > 60 && Math.min(...ok) < 40);
  assert.equal(corr([1, 2, 3, null], [2, 4, 6, 1]), 1);
});
