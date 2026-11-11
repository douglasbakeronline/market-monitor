import { test } from "node:test";
import assert from "node:assert/strict";
import { bounceToday, shortTermToday, addShort, updateShort, summariseShort, shortTermAlert, testedRecord } from "../src/shortTerm.js";
import { allowAlert } from "../src/alertProfile.js";

const day = (i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
// Steady uptrend, then the last n bars fall sharply (a dip above the 200-day).
function rows({ n = 260, dipBars = 0, jump = 0, vol = 1e6, lastVol = 1e6 } = {}) {
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= i >= n - dipBars ? 0.97 : 1.002;
    if (jump && i === n - 1) p *= 1 + jump;
    out.push({ date: day(i), open: p, high: p, low: p, close: p, volume: i === n - 1 ? lastVol : vol });
  }
  return out;
}

test("bounceToday: fires on a sharp dip above the 200-day, not in a steady rise", () => {
  const b = bounceToday(rows({ dipBars: 3 }));
  assert.ok(b, "fires");
  assert.ok(b.rsi2 < 10 && b.vs200 > 0 && b.fall3 < -8);
  assert.equal(bounceToday(rows()), null);
  assert.equal(bounceToday(rows({ n: 150, dipBars: 3 })), null, "needs 200 sessions");
});

test("shortTermToday ranks drift first, skips bounces with results within 7 days", () => {
  const items = [
    { symbol: "A", ticker: "A", name: "A", market: "US", index: "S&P 500", longTerm: { score: 70 } },
    { symbol: "B", ticker: "B", name: "B", market: "US", index: "S&P 500", earnings: { days: 3 } },
    { symbol: "C", ticker: "C", name: "C", market: "UK", index: "FTSE 100" },
  ];
  const r = shortTermToday(items, { A: rows({ dipBars: 3 }), B: rows({ dipBars: 3 }), C: rows({ jump: 0.06, lastVol: 5e6 }) });
  assert.deepEqual(r.drift.map((x) => x.ticker), ["C"]);
  assert.equal(r.drift[0].volX, 5);
  assert.deepEqual(r.bounce.map((x) => x.ticker), ["A"]);
});

test("updateShort: bounce exits at the first close above the 5-day average; drift after 20 sessions; costs and index", () => {
  const base = rows({ dipBars: 3 });
  const sigDate = base.at(-1).date;
  let p = base.at(-1).close;
  const after = [0.99, 1.05, 1.02].map((m, k) => { p *= m; return { date: day(260 + k), open: p, high: p, low: p, close: p, volume: 1e6 }; });
  const t0 = addShort([], [{ kind: "bounce", symbol: "A", ticker: "A", name: "A", market: "US", date: sigDate, price: base.at(-1).close }])[0];
  const idx = new Map([...base, ...after].map((r) => [r.date, 100]));
  const t = updateShort(t0, [...base, ...after], idx);
  assert.equal(t.status, "closed");
  assert.equal(t.exitDate, day(261), "second session closes above the 5-day average");
  assert.equal(t.vsIdx, t.netPct, "flat index");
  const d0 = { kind: "drift", symbol: "C", market: "UK", signalDate: sigDate, status: "pending" };
  assert.equal(updateShort(d0, [...base, ...after]).status, "open", "20 sessions not up");
});

test("addShort keeps one open trade per symbol and kind; summary counts closed", () => {
  let log = addShort([], [{ kind: "bounce", symbol: "A", date: "2026-11-10" }, { kind: "drift", symbol: "A", date: "2026-11-10" }]);
  log = addShort(log, [{ kind: "bounce", symbol: "A", date: "2026-11-11" }]);
  assert.equal(log.length, 2);
  log[0] = { ...log[0], status: "closed", netPct: 1.2, vsIdx: 0.5 };
  const s = summariseShort(log);
  assert.deepEqual(s.bounce, { closed: 1, open: 0, win: 100, avg: 1.2, vsIdx: 0.5 });
  assert.equal(s.drift.open, 1);
});

test("shortTermAlert: once per date, ranked, with the tested and live record; allowed under plan-swing", () => {
  const lab = { results: [
    { key: "drift", stop: false, signal: { n: 2453, avg: 1.36, win: 54, vsIdx: 0.52 }, baseline: { avg: 0.78 }, edge: 0.58, yearsAhead: 6, yearsCounted: 9 },
    { key: "dip", stop: false, signal: { n: 33793, avg: -0.08, win: 61, vsIdx: -0.31 }, baseline: { avg: -0.24 }, edge: 0.16, yearsAhead: 7, yearsCounted: 10 } ] };
  const st = { date: "2026-11-11", drift: [{ ticker: "C", name: "Cee", movePct: 6, volX: 5, results: true }], bounce: [{ ticker: "A", name: "Ay", rsi2: 4.2, fall3: -8.7, vs200: 6 }],
    tested: testedRecord(lab), live: { drift: { closed: 0 }, bounce: { closed: 3, win: 67, avg: 0.4 } } };
  const a = shortTermAlert(st, null);
  assert.equal(a.kind, "short");
  assert.equal(a.title, "Short-term signals: C, A");
  assert.match(a.body, /avg \+1.36% a trade after costs vs \+0.78% random, 54% won, ahead in 6 of 9 years; live: none closed yet/);
  assert.match(a.body, /61% won but avg -0.08% a trade after costs/);
  assert.ok(a.body.indexOf("C (Cee)") < a.body.indexOf("A (Ay)"));
  assert.match(a.body, /Paper only/);
  assert.equal(shortTermAlert(st, "2026-11-11"), null, "already sent");
  assert.equal(shortTermAlert({ ...st, drift: [], bounce: [] }, null), null);
  assert.equal(allowAlert(a, "plan-swing"), true);
});
