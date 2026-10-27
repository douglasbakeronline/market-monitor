import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyHistory } from "../src/data/feargreed.js";
import { parseYahoo } from "../src/data/prices.js";
import { sma, rsi, drawdown, macd, crossed } from "../src/indicators.js";
import { zonedTime, partsIn, isoWeek, interp } from "../src/util.js";
import { nextSlot, inQuietHours } from "../src/schedule.js";
import { regime, evaluateAlerts, deepestTier, buildFearSessions, snapshot } from "../src/signals.js";
import { forwardReturns } from "../src/context.js";
import { longTerm, swingSignals, swingVerdict, technicals } from "../src/research.js";

// Helpers -------------------------------------------------------------------
const rowsFrom = (closes, start = "2024-01-01") => closes.map((c, i) => {
  const d = new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10);
  return { date: d, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 };
});
const snap = (over = {}) => ({ name: "S&P 500", drawdownPct: -2, peak: 100, vs200Pct: 5, above200: true, ...over });

// Dates ---------------------------------------------------------------------
test("F&G daily points keep their UTC date (no shift to the previous day)", () => {
  const h = dailyHistory([
    { x: Date.parse("2026-10-23T00:00:00Z"), y: 23 },
    { x: Date.parse("2026-10-26T00:00:00Z"), y: 27.2 },
    { x: Date.parse("2026-10-26T23:21:20Z"), y: 28.4 },
  ]);
  assert.deepEqual(h.map((p) => p.date), ["2026-10-23", "2026-10-26"]);
  assert.equal(h[1].y, 28, "latest reading for a day wins");
});

test("Yahoo parser skips null closes and dates bars in the exchange zone", () => {
  const res = { meta: { exchangeTimezoneName: "Europe/London", currency: "GBp", regularMarketPrice: 105, regularMarketTime: Date.parse("2026-10-27T10:00:00Z") / 1000 },
    timestamp: [Date.parse("2026-10-23T08:00:00Z") / 1000, Date.parse("2026-10-26T08:00:00Z") / 1000, Date.parse("2026-10-27T08:00:00Z") / 1000],
    indicators: { quote: [{ close: [100, 102, null], open: [100, 101, null], high: [101, 103, null], low: [99, 100, null], volume: [1, 1, null] }] } };
  const p = parseYahoo(res);
  assert.deepEqual(p.rows.map((r) => r.date), ["2026-10-23", "2026-10-26", "2026-10-27"]);
  assert.equal(p.rows.at(-1).close, 105, "live quote fills today's bar");
});

test("zonedTime handles both sides of the clocks changing", () => {
  assert.equal(zonedTime("Europe/London", "2026-10-23", "08:15").toISOString(), "2026-10-23T07:15:00.000Z"); // BST
  assert.equal(zonedTime("Europe/London", "2026-10-26", "08:15").toISOString(), "2026-10-26T08:15:00.000Z"); // GMT
  assert.equal(zonedTime("America/New_York", "2026-10-27", "09:45").toISOString(), "2026-10-27T13:45:00.000Z"); // EDT
  assert.equal(zonedTime("America/New_York", "2026-11-02", "09:45").toISOString(), "2026-11-02T14:45:00.000Z"); // EST
});

test("next slot: Tuesday 01:10 London is the UK open at 08:15", () => {
  const n = nextSlot(new Date("2026-10-27T01:10:00Z"));
  assert.equal(n.id, "uk-open");
  assert.equal(n.at.toISOString(), "2026-10-27T08:15:00.000Z");
});

test("next slot: Friday after the US close is the Sunday digest", () => {
  const n = nextSlot(new Date("2026-10-30T20:30:00Z"));
  assert.equal(n.id, "weekly-digest");
  assert.equal(partsIn("Europe/London", n.at).weekday, 0);
});

test("no gap between weekday slots exceeds the 5h40m a job can wait", () => {
  let t = new Date("2026-10-26T07:00:00Z"); // Monday
  const end = new Date("2026-10-30T20:00:00Z");
  while (t < end) {
    const n = nextSlot(t);
    if (n.at > end) break;
    if (n.id !== "uk-open") assert.ok(n.waitSec <= 340 * 60, `gap too long after ${t.toISOString()} → ${n.id}`);
    t = new Date(n.at.getTime() + 60_000);
  }
});

test("isoWeek", () => {
  assert.equal(isoWeek("2026-11-01"), "2026-W44");
  assert.equal(isoWeek("2026-11-02"), "2026-W45");
});

// Indicators ----------------------------------------------------------------
test("sma and drawdown", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const dd = drawdown(rowsFrom([100, 120, 90, 108]));
  assert.equal(dd.peak, 120);
  assert.equal(Math.round(dd.pct), -10);
});

test("drawdown uses the 52-week window, not just the last 100 sessions", () => {
  const closes = [200, ...Array(150).fill(150), ...Array(100).fill(140)];
  assert.equal(drawdown(rowsFrom(closes), 252).peak, 200);
});

test("rsi is 100 for a straight line up and low for a straight line down", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(rsi(up).at(-1), 100);
  assert.ok(rsi(up.slice().reverse()).at(-1) < 5);
});

test("macd cross detection", () => {
  const c = [...Array.from({ length: 60 }, (_, i) => 100 - i * 0.5), ...Array.from({ length: 15 }, (_, i) => 70 + i * 2)];
  const m = macd(c);
  assert.ok(crossed(m.line, m.signal, 15, "up"));
  assert.ok(!crossed(m.line, m.signal, 15, "down"));
});

test("interp clamps and interpolates", () => {
  assert.equal(interp(5, [[0, 0], [10, 100]]), 50);
  assert.equal(interp(-5, [[0, 0], [10, 100]]), 0);
  assert.equal(interp(null, [[0, 0], [10, 100]]), null);
});

// Signals -------------------------------------------------------------------
test("regime precedence", () => {
  assert.equal(regime({ sp: snap({ drawdownPct: -12 }), vix: { level: 32 }, fg: { score: 40 } }).key, "capitulation");
  assert.equal(regime({ sp: snap({ drawdownPct: -12 }), vix: { level: 22 }, fg: { score: 40 } }).key, "correction");
  assert.equal(regime({ sp: snap({ drawdownPct: -1, vs200Pct: 12 }), vix: { level: 12 }, fg: { score: 85 } }).key, "overheated");
  assert.equal(regime({ sp: snap({ drawdownPct: -1 }), vix: { level: 16 }, fg: { score: 78 } }).key, "euphoric");
  assert.equal(regime({ sp: snap({ drawdownPct: -2.5 }), vix: { level: 18 }, fg: { score: 27 } }).key, "fear-no-dip");
  assert.equal(regime({ sp: snap({ drawdownPct: -7 }), vix: { level: 18 }, fg: { score: 40 } }).key, "pullback");
  assert.equal(regime({ sp: snap({ drawdownPct: -4, above200: false, vs200Pct: -2 }), vix: { level: 18 }, fg: { score: 50 } }).key, "downtrend");
  assert.equal(regime({ sp: snap(), vix: { level: 15 }, fg: { score: 55 } }).key, "healthy");
  assert.equal(regime({ sp: null, vix: null, fg: { score: 55 } }).key, "unknown");
});

test("buy alert fires once per deeper tier and re-arms after recovery", () => {
  const fg = { score: 20 };
  let st = {};
  let r = evaluateAlerts({ markets: { US: snap({ drawdownPct: -11 }) }, fg, vix: null, pricesOk: true, fgOk: true }, st);
  assert.equal(r.alerts.filter((a) => a.kind === "buy").length, 1);
  r = evaluateAlerts({ markets: { US: snap({ drawdownPct: -12 }) }, fg, vix: null, pricesOk: true, fgOk: true }, r.state);
  assert.equal(r.alerts.filter((a) => a.kind === "buy").length, 0, "same tier: no repeat");
  r = evaluateAlerts({ markets: { US: snap({ drawdownPct: -16 }) }, fg, vix: null, pricesOk: true, fgOk: true }, r.state);
  assert.equal(r.alerts.filter((a) => a.kind === "buy").length, 1, "deeper tier: alert");
  r = evaluateAlerts({ markets: { US: snap({ drawdownPct: -4 }) }, fg, vix: null, pricesOk: true, fgOk: true }, r.state);
  assert.equal(r.state.buyTier.US, 0, "re-armed");
});

test("UK buy tiers are tracked separately", () => {
  const r = evaluateAlerts({ markets: { US: snap({ drawdownPct: -2 }), UK: snap({ name: "FTSE 100", drawdownPct: -15.5 }) }, fg: { score: 22 }, vix: null, pricesOk: true, fgOk: true }, {});
  const buys = r.alerts.filter((a) => a.kind === "buy");
  assert.equal(buys.length, 1);
  assert.match(buys[0].title, /FTSE/);
});

test("stale prices never fire or reset price signals (the old 0% bug)", () => {
  const st = { buyTier: { US: -15 }, greedActive: false };
  const r = evaluateAlerts({ markets: { US: snap({ drawdownPct: 0 }) }, fg: { score: 90 }, vix: null, pricesOk: false, fgOk: true }, st);
  assert.equal(r.alerts.length, 0);
  assert.equal(r.state.buyTier.US, -15);
});

test("fear-without-a-dip fires once and resets when fear fades", () => {
  let r = evaluateAlerts({ markets: { US: snap({ drawdownPct: -2.5 }) }, fg: { score: 27 }, vix: null, pricesOk: true, fgOk: true }, {});
  assert.ok(r.alerts.some((a) => a.kind === "fear-no-dip"));
  r = evaluateAlerts({ markets: { US: snap({ drawdownPct: -2.5 }) }, fg: { score: 28 }, vix: null, pricesOk: true, fgOk: true }, r.state);
  assert.ok(!r.alerts.some((a) => a.kind === "fear-no-dip"));
  r = evaluateAlerts({ markets: { US: snap({ drawdownPct: -2.5 }) }, fg: { score: 45 }, vix: null, pricesOk: true, fgOk: true }, r.state);
  assert.equal(r.state.fearNoDipActive, false);
});

test("trim needs extreme greed, a stretched market and calm volatility", () => {
  const base = { markets: { US: snap({ drawdownPct: -1, vs200Pct: 12 }) }, pricesOk: true, fgOk: true };
  assert.ok(evaluateAlerts({ ...base, fg: { score: 82 }, vix: { level: 13 } }, {}).alerts.some((a) => a.kind === "trim"));
  assert.ok(!evaluateAlerts({ ...base, fg: { score: 82 }, vix: { level: 19 } }, {}).alerts.some((a) => a.kind === "trim"));
});

test("deepestTier", () => {
  assert.equal(deepestTier(-9.9), null);
  assert.equal(deepestTier(-21).drawdown, -20);
});

test("fear sessions use the stored open when captured", () => {
  const h = [20, 21, 22, 23, 24, 30].map((y, i) => ({ date: `2026-10-${String(19 + i).padStart(2, "0")}`, y }));
  const s = buildFearSessions(h, { "2026-10-24": { open: 25 } });
  assert.equal(s.length, 5);
  assert.equal(s.at(-1).basis, "oc");
  assert.equal(s.at(-1).pct, 20);
});

test("snapshot computes vs-200 and drawdown", () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);
  closes.push(closes.at(-1) * 0.9);
  const s = snapshot("X", "X", { rows: rowsFrom(closes) });
  assert.ok(s.drawdownPct < -9.9 && s.drawdownPct > -10.1);
  assert.equal(s.fiveDay.length, 5);
});

// Context -------------------------------------------------------------------
test("forward returns compare similar readings with the baseline", () => {
  const rows = rowsFrom(Array.from({ length: 400 }, (_, i) => 100 + i));
  const fg = Object.fromEntries(rows.slice(0, 300).map((r, i) => [r.date, i % 2 ? 20 : 60]));
  const c = forwardReturns(fg, rows, 22);
  const m1 = c.horizons.find((h) => h.key === "m1");
  assert.ok(m1.similar.n > 100);
  assert.equal(m1.similar.positive, 100);
});

// Research ------------------------------------------------------------------
test("long-term score: a cheap, high-quality stock beats an expensive, weak one", () => {
  const t = { last: 100, offHigh: -15, vs200: -3, rsi: 38 };
  const good = longTerm({ sector: "Technology", profitMargin: 0.3, roe: 0.3, revenueGrowth: 0.15, earningsGrowth: 0.2, debtToEquity: 20, forwardPE: 14, trailingPE: 16, peg: 0.9, evToEbitda: 10, targetMean: 125, recommendationMean: 1.8 }, t);
  const bad = longTerm({ sector: "Technology", profitMargin: -0.05, roe: -0.02, revenueGrowth: -0.05, earningsGrowth: -0.3, debtToEquity: 300, forwardPE: 80, trailingPE: 120, peg: 4, evToEbitda: 60, targetMean: 90, recommendationMean: 3.5 }, { ...t, offHigh: -1, vs200: 30, rsi: 78 });
  assert.ok(good.score > 75, `good ${good.score}`);
  assert.ok(bad.score < 30, `bad ${bad.score}`);
  assert.equal(good.verdict, "Good entry");
  assert.equal(bad.verdict, "Expensive");
});

test("banks skip debt/equity and EV/EBITDA", () => {
  const lt = longTerm({ sector: "Financial Services", debtToEquity: 900, evToEbitda: 50, forwardPE: 11 }, { last: 1 });
  assert.ok(!lt.pillars.flatMap((p) => p.items).some((i) => ["debtToEquity", "evToEbitda"].includes(i.key)));
  assert.equal(lt.financials, true);
});

test("swing: oversold pullback in an uptrend is a setup; earnings soon is flagged", () => {
  const closes = [...Array.from({ length: 220 }, (_, i) => 100 + i * 0.5), ...Array.from({ length: 8 }, (_, i) => 209 - i * 4)];
  const t = technicals(rowsFrom(closes));
  const sig = swingSignals(t);
  assert.ok(sig.some((s) => s.key === "oversold-up" || s.key === "oversold"), JSON.stringify(sig.map((s) => s.key)));
  const v = swingVerdict(t, [{ weight: 30 }], 3);
  assert.equal(v.verdict, "Setup (earnings risk)");
  assert.ok(v.stop < t.last);
});

test("quiet hours span midnight in London time", () => {
  assert.equal(inQuietHours(new Date("2026-10-27T01:30:00Z")), true);
  assert.equal(inQuietHours(new Date("2026-10-27T07:05:00Z")), false);
  assert.equal(inQuietHours(new Date("2026-07-01T21:30:00Z")), true); // 22:30 BST
  assert.equal(inQuietHours(new Date("2026-07-01T20:30:00Z")), false); // 21:30 BST
});
