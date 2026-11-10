import { test } from "node:test";
import assert from "node:assert/strict";
import { prepare, signal, simulate, netPct, runStock, analyseLab, STRATEGIES } from "../src/swingLab.js";

// Synthetic bars: a slow uptrend with small noise.
function bars(n, f = (i) => 100 * Math.pow(1.0006, i) * (1 + 0.004 * Math.sin(i * 1.7)), vol = () => 1e6) {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { date: new Date(Date.UTC(2015, 0, 1) + i * 86400000).toISOString().slice(0, 10), open: c, high: c * 1.005, low: c * 0.995, close: c, volume: vol(i) };
  });
}

test("drift fires on a +4% day on 3x volume, not on volume alone or the move alone", () => {
  const rows = bars(320);
  rows[300] = { ...rows[300], close: rows[299].close * 1.05, high: rows[299].close * 1.06, volume: 4e6 };
  const ind = prepare(rows);
  assert.equal(signal("drift", rows, ind, 300), true);
  const quiet = bars(320); quiet[300] = { ...quiet[300], close: quiet[299].close * 1.05 };
  assert.equal(signal("drift", quiet, prepare(quiet), 300), false);
  const flat = bars(320); flat[300] = { ...flat[300], volume: 5e6 };
  assert.equal(signal("drift", flat, prepare(flat), 300), false);
});

test("dip needs the uptrend and a 2-day RSI under 10; exits at the first close above the 5-day average", () => {
  const rows = bars(330, (i) => 100 * Math.pow(1.002, i) * (1 + 0.004 * Math.sin(i * 1.7)));
  // Three sharp down closes in an uptrend, then a rebound.
  for (const [i, k] of [[300, 0.97], [301, 0.97], [302, 0.97]]) rows[i] = { ...rows[i], close: rows[i - 1].close * k, open: rows[i - 1].close, low: rows[i - 1].close * k * 0.99 };
  for (let i = 303; i < 330; i++) { const c = rows[302].close * (1 + 0.01 * (i - 302)); rows[i] = { ...rows[i], open: c, high: c * 1.005, low: c * 0.995, close: c }; }
  const ind = prepare(rows);
  assert.equal(signal("dip", rows, ind, 302), true);
  const t = simulate(rows, ind, 302, "ma5");
  assert.equal(t.entryIdx, 303);
  assert.ok(t.exitIdx > 303 && t.exitIdx <= 312);
  assert.ok(rows[t.exitIdx].close > ind.sma5[t.exitIdx]);
  // In a downtrend the same dip does not count.
  const down = bars(330, (i) => 200 * Math.pow(0.999, i));
  const di = prepare(down);
  assert.equal(signal("dip", down, di, 302), false);
});

test("high fires on the first 52-week closing high in 20 sessions only", () => {
  const rows = bars(320, (i) => 100 + (i < 290 ? Math.sin(i / 9) : 2 + (i - 290)));
  const ind = prepare(rows);
  const fired = [];
  for (let d = 252; d < 320; d++) if (signal("high", rows, ind, d)) fired.push(d);
  assert.ok(fired.length >= 1);
  for (let i = 1; i < fired.length; i++) assert.ok(fired[i] - fired[i - 1] > 20);
});

test("hold-20 exits on the 20th session; the stop exits at the stop, or at the open on a gap", () => {
  const rows = bars(320);
  const ind = prepare(rows);
  const t = simulate(rows, ind, 280, "hold20");
  assert.equal(t.exitIdx - t.entryIdx + 1, 20);
  assert.equal(t.exit, rows[t.exitIdx].close);
  const gap = bars(320);
  const gi = prepare(gap);
  const entry = gap[281].open, stopPx = entry - 2 * gi.atr14[280];
  gap[285] = { ...gap[285], open: stopPx * 0.9, low: stopPx * 0.85, close: stopPx * 0.95 };
  const s = simulate(gap, gi, 280, "hold20", { stop: true });
  assert.equal(s.exitIdx, 285);
  assert.equal(s.stopped, true);
  assert.ok(Math.abs(s.exit - stopPx * 0.9) < 1e-9);
  assert.equal(simulate(rows, ind, 319, "hold20"), null);
});

test("costs: US pays 0.3%, UK 0.5% per round trip", () => {
  assert.ok(Math.abs(netPct({ entry: 100, exit: 102 }, "US") - 1.7) < 1e-9);
  assert.ok(Math.abs(netPct({ entry: 100, exit: 102 }, "UK") - 1.5) < 1e-9);
});

test("runStock and analyseLab: every strategy and stop setting reported, verdict needs every check", () => {
  const rows = bars(900, (i) => 100 * Math.pow(1.0005, i) * (1 + 0.03 * Math.sin(i / 3)), (i) => (i % 97 === 0 ? 5e6 : 1e6));
  const index = new Map(rows.map((r) => [r.date, r.close]));
  const trades = runStock(rows, "US", { index, seed: 3 });
  assert.ok(trades.some((t) => t.kind === "signal") && trades.some((t) => t.kind === "random") && trades.some((t) => t.kind === "cond"));
  assert.ok(trades.every((t) => Number.isFinite(t.net)));
  const res = analyseLab(trades);
  assert.equal(res.length, STRATEGIES.length * 2);
  for (const r of res) {
    assert.equal(r.clear, Object.values(r.checks).every(Boolean));
    assert.equal(r.checks.sample, r.signal.n >= 300);
  }
  // Hand-made trades: a clear winner passes, the same with a UK loss fails on markets.
  const mk = (kind, net, market = "US", year = "2020") => ({ strategy: "drift", kind, stop: false, market, year, days: 20, net, idx: 0 });
  const win = [];
  for (const y of ["2019", "2020", "2021", "2022"]) for (let i = 0; i < 100; i++) { win.push(mk("signal", 1.5 + (i % 3), "US", y)); win.push(mk("random", 0.5 + (i % 3), "US", y)); }
  const ok = analyseLab(win).find((r) => r.key === "drift" && !r.stop);
  assert.equal(ok.clear, true);
  assert.equal(ok.edge, 1);
  const uk = win.concat(Array.from({ length: 120 }, (_, i) => mk("signal", -3, "UK", "2021")), Array.from({ length: 120 }, () => mk("random", 1, "UK", "2021")));
  assert.equal(analyseLab(uk).find((r) => r.key === "drift" && !r.stop).checks.markets, false);
});
