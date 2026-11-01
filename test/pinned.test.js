import { test } from "node:test";
import assert from "node:assert/strict";
import { technicals, swingSignals, swingVerdict, dailyVol } from "../src/research.js";

// A year of normal moves, then a month pinned within a few pence (takeover).
function rows({ pinnedTail = 0, n = 260 } = {}) {
  const out = []; let p = 1000;
  for (let i = 0; i < n; i++) {
    const pinned = i >= n - pinnedTail;
    p = pinned ? 1500 + ((i % 3) - 1) * 1.5 : p * (1 + (i % 2 ? 0.018 : -0.016));
    const d = new Date(Date.UTC(2025, 9, 1) + i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, open: p, high: p * (pinned ? 1.0008 : 1.01), low: p * (pinned ? 0.9992 : 0.99), close: p, volume: 1000 });
  }
  return out;
}

test("daily volatility is the sd of log returns in percent", () => {
  assert.equal(dailyVol([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]), 0);
  assert.equal(dailyVol([1, 2]), null, "needs at least 10 returns");
});

test("a takeover-pinned price is flagged and never a swing setup", () => {
  const t = technicals(rows({ pinnedTail: 30 }));
  assert.ok(t.pinned, `vol21 ${t.vol21} vs vol252 ${t.vol252}`);
  const sig = swingSignals(t);
  assert.deepEqual(sig.map((s) => s.key), ["pinned"]);
  const v = swingVerdict(t, sig, null);
  assert.equal(v.verdict, "Avoid");
  assert.ok(v.stopPct <= -2, `stop floor from normal volatility, got ${v.stopPct}%`);
});

test("a normal stock is not flagged and keeps its 2x ATR stop", () => {
  const t = technicals(rows());
  assert.equal(t.pinned, false);
  const v = swingVerdict(t, swingSignals(t), null);
  assert.equal(v.stop, Math.round((t.last - 2 * t.atr) * 100) / 100);
});
