import { test } from "node:test";
import assert from "node:assert/strict";
import { fundingCheck, maxFallPct, FUND_BAR } from "../src/swingBook.js";
import { driftBook, randomDriftBooks } from "../src/driftBook.js";
import { momentum, equalWeight, onMonths, studyMarket, momVerdict, momentumNow, cleanSpikes, monthly } from "../src/momentum.js";
import { updateDrift } from "../src/swingLab.js";

// --- Funding bar -------------------------------------------------------------
const book = (o = {}) => ({ start: "2026-11-02", equity0: 10000, value: 10000, returnPct: 0, closed: 0, avgNetR: null, curve: [], paused: false, random: null, sp: null, ...o });

test("funding bar: an early book fails with the trade count named", () => {
  const f = fundingCheck(book({ closed: 2, avgNetR: -1.05, value: 9760, returnPct: -2.4, curve: [{ date: "2026-11-05", equity: 9800 }], random: { beatShare: 20 }, sp: { pct: -0.4 } }));
  assert.equal(f.total, 5);
  assert.equal(f.met, false);
  assert.equal(f.passed, 1, "only the fall check passes");
  assert.match(f.line, /needs 28 more closed trades/);
});

test("funding bar: a strong book meets every check", () => {
  const f = fundingCheck(book({ closed: 40, avgNetR: 0.35, value: 11800, returnPct: 18, curve: [{ date: "a", equity: 10500 }, { date: "b", equity: 9800 }, { date: "c", equity: 11500 }], random: { beatShare: 91 }, sp: { pct: 6 } }));
  assert.equal(f.met, true);
  assert.match(f.line, /worth a decision/);
});

test("funding bar: worst fall and the pause", () => {
  assert.equal(maxFallPct(book({ curve: [{ equity: 12000 }, { equity: 9600 }], value: 10000 })), 20);
  const f = fundingCheck(book({ closed: 40, avgNetR: 0.5, returnPct: 10, value: 11000, random: { beatShare: 95 }, sp: { pct: 1 }, paused: true }));
  assert.equal(f.checks.find((c) => c.key === "fall").ok, false);
  assert.equal(fundingCheck(null), null);
  assert.equal(FUND_BAR.minClosed, 30);
});

test("funding bar works on % averages for the drift book", () => {
  const f = fundingCheck(book({ closed: 31, value: 10500, returnPct: 5, random: { beatShare: 85 }, sp: { pct: 2 } }), { avg: 1.8, minAvg: 1.5, unit: "%" });
  assert.equal(f.met, true);
  assert.match(f.checks[1].label, /\+1\.5%/);
});

// --- Drift book ----------------------------------------------------------------
const tr = (o) => ({ kind: "up", market: "US", status: "open", entry: 100, ...o });

test("drift book: four slots, quarter each, exits at 20 sessions", () => {
  const log = [
    tr({ id: "a", symbol: "A", entryDate: "2026-01-02", net20: 10, date20: "2026-01-30", status: "closed", volX: 3.5 }),
    tr({ id: "b", symbol: "B", entryDate: "2026-01-02", net20: -4, date20: "2026-01-30", status: "closed", volX: 5 }),
    tr({ id: "c", symbol: "C", entryDate: "2026-01-02", sessions: 5, netPct: 2, volX: 4 }),
    tr({ id: "d", symbol: "D", entryDate: "2026-01-02", sessions: 5, netPct: 0, volX: 6 }),
    tr({ id: "e", symbol: "E", entryDate: "2026-01-02", sessions: 5, netPct: 50, volX: 3.2 }), // fifth: no slot
    tr({ id: "f", symbol: "F", kind: "down", entryDate: "2026-01-02", sessions: 5, netPct: 9 }), // falls are not traded
    tr({ id: "g", symbol: "G", entryDate: "2026-01-30", sessions: 1, netPct: 1, results: true }), // slot freed the same day
    { id: "h", symbol: "H", kind: "up", status: "pending", signalDate: "2026-02-02", signalPrice: 50, volX: 4, movePct: 6 },
  ];
  const b = driftBook(log);
  assert.equal(b.closed, 2);
  // A: +10% of 2500 = +250; B: -4% of 2500 = -100.
  assert.equal(b.realised, 10150);
  assert.deepEqual(b.open.map((x) => x.symbol).sort(), ["C", "D", "G"]);
  assert.ok(!b.open.some((x) => x.symbol === "E"));
  // G enters with a quarter of the realised 10150.
  assert.equal(b.open.find((x) => x.symbol === "G").pos, 2537.5);
  assert.equal(b.orders.length, 1);
  assert.equal(b.orders[0].symbol, "H");
  assert.equal(b.avgNetPct, 3);
  assert.equal(b.winRate, 50);
});

test("drift book: same-day choice prefers results, then volume", () => {
  const log = ["A", "B", "C", "D", "E"].map((s, i) => tr({ id: s, symbol: s, entryDate: "2026-01-02", sessions: 1, netPct: 0, volX: 3 + i, results: s === "A" }));
  const b = driftBook(log);
  assert.deepEqual(b.open.map((x) => x.symbol).sort(), ["A", "C", "D", "E"]);
  const r = randomDriftBooks(log, { runs: 20 });
  assert.equal(r.runs, 20);
  assert.ok(r.beatShare >= 0 && r.beatShare <= 100);
  assert.equal(driftBook([]).start, null);
});

test("updateDrift records the 20-session date", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ date: `2026-01-${String(i + 2).padStart(2, "0")}`, open: 100, close: 100 + i }));
  const t = updateDrift({ id: "x", symbol: "X", market: "US", kind: "up", signalDate: "2026-01-01", signalPrice: 100, status: "pending" }, rows);
  assert.equal(t.date20, "2026-01-21");
  assert.ok(t.net20 > 0);
});

// --- Momentum --------------------------------------------------------------------
const months = Array.from({ length: 40 }, (_, i) => `${2010 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
const grow = (g) => months.map((_, i) => 100 * Math.pow(1 + g, i));

test("momentum holds the strongest names and charges costs on turnover", () => {
  const closes = { W: grow(0.03), X: grow(0.02), Y: grow(0.0), Z: grow(-0.01) };
  const idx = grow(0.01);
  const rs = momentum(months, closes, idx, { top: 2, cost: 0.004 });
  assert.equal(rs[0].month, months[13]);
  assert.deepEqual(rs[0].held, ["W", "X"]);
  // First month: buy 100% (turnover 1, cost 0.2%); after that weights only drift.
  assert.ok(Math.abs(rs[0].r - ((0.03 + 0.02) / 2 - 0.002)) < 1e-9);
  assert.ok(rs[1].turnover < 0.05);
  const ew = equalWeight(months, closes, { start: months[13] });
  assert.equal(ew[0].month, months[13]);
});

test("momentum goes to cash below the 10-month average", () => {
  const closes = { W: grow(0.03), X: grow(0.02) };
  const falling = months.map((_, i) => 1000 * Math.pow(0.98, i));
  const rs = momentum(months, closes, falling, { top: 1, cost: 0.003 });
  assert.ok(rs.every((x) => x.cash && x.held.length === 0));
  assert.ok(rs.slice(1).every((x) => x.r === 0), "no cost while out");
  const noFilter = momentum(months, closes, falling, { top: 1, trend: false });
  assert.ok(noFilter.every((x) => !x.cash));
});

test("momentum ignores names without 12 months and treats a missing month as flat", () => {
  const late = grow(0.1).map((v, i) => (i < 20 ? null : v));
  const closes = onMonths({ A: months.map((m, i) => ({ month: m, close: grow(0.02)[i] })), L: months.map((m, i) => ({ month: m, close: late[i] })).filter((x) => x.close != null) }, months);
  assert.equal(closes.L[0], null);
  const rs = momentum(months, closes, grow(0.01), { top: 1 });
  assert.deepEqual(rs[0].held, ["A"], "L has no history yet");
  assert.ok(rs.some((x) => x.held[0] === "L"), "L joins once it has 12 months");
});

test("study and verdict shape", () => {
  const closes = { W: grow(0.03), X: grow(0.02), Y: grow(0.0), Z: grow(-0.01) };
  const s = studyMarket(months, closes, grow(0.01), "US", { start: months[13], split: "2011-06" });
  assert.equal(s.results.length, 4);
  assert.equal(s.results[0].key, "primary");
  const v = momVerdict([s, { ...s, market: "UK" }]);
  assert.equal(typeof v.pass, "boolean");
  assert.deepEqual(Object.keys(v.byMarket), ["US", "UK"]);
  const now = momentumNow(months, closes, grow(0.01), { top: 2 });
  assert.deepEqual(now.top.map((x) => x.s), ["W", "X"]);
  assert.equal(now.trendUp, true);
});

test("spike cleaning and monthly returns", () => {
  const xs = [{ month: "a", close: 100 }, { month: "b", close: 10000 }, { month: "c", close: 101 }, { month: "d", close: 1 }, { month: "e", close: 102 }];
  assert.deepEqual(cleanSpikes(xs).map((x) => x.month), ["a", "c", "e"]);
  assert.deepEqual(monthly([{ month: "a", close: 100 }, { month: "b", close: 110 }]).map((x) => Math.round(x.r * 100)), [10]);
});
