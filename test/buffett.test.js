import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTimeseries, buffettQuality, buffettLens, valueMultiple, kindOf, pickBuffett, freshQ } from "../src/buffett.js";
import { newBuffettBook, reviewDue, review, fillOrders, markBuffett, buffettSummary, bookValue } from "../src/buffettBook.js";
import { newMomentumBook, rebalanceDue, monthView, mom121, trendUp, rankMomentum, rebalance, markBook, bookSummary } from "../src/momentumBook.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/timeseries.json", import.meta.url), "utf8"));

// --- Lens ------------------------------------------------------------------------
test("parses Yahoo's annual timeseries, oldest first", () => {
  const s = parseTimeseries(FX.KO);
  assert.deepEqual(s.years, ["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"]);
  assert.equal(s.NetIncome.at(-1), 13107000000);
  assert.equal(s.CapitalExpenditure[0], -1484000000);
  assert.deepEqual(parseTimeseries(null).years, []);
});

test("Coca-Cola passes every quality test; Apple too, but is far from cheap", () => {
  const ko = buffettQuality(parseTimeseries(FX.KO), { sector: "Consumer Staples" });
  assert.equal(ko.kind, "co");
  assert.equal(ko.applicable, 6);
  assert.equal(ko.quality, true);
  assert.equal(ko.epsGrowth, 0.07, "growth capped at 7%");
  const aapl = buffettLens(buffettQuality(parseTimeseries(FX.AAPL), { sector: "Information Technology" }), 36);
  assert.equal(aapl.verdict, "Wonderful, not cheap");
  assert.ok(aapl.mos < 0);
  assert.equal(aapl.checks.at(-1).key, "mos");
});

test("banks use return on equity and skip margin, debt and owner-earnings tests", () => {
  const jpm = buffettQuality(parseTimeseries(FX.JPM), { sector: "Financials" });
  assert.equal(jpm.kind, "fin");
  assert.deepEqual(jpm.checks.map((c) => c.key), ["returns", "earnings", "shares"]);
  assert.equal(jpm.quality, true);
  const hsbc = buffettLens(buffettQuality(parseTimeseries(FX["HSBA.L"]), { sector: "Financials" }), 9);
  assert.equal(hsbc.verdict, "Fails 1 test");
  assert.match(hsbc.note, /return on equity/);
});

test("a cheap wonderful company is in the buy zone; REITs and thin data are not assessed", () => {
  const ko = buffettQuality(parseTimeseries(FX.KO), { sector: "Consumer Staples" });
  const cheap = buffettLens(ko, 10);
  assert.equal(cheap.verdict, "Buffett buy zone");
  assert.ok(cheap.mos >= 0.25);
  assert.equal(buffettLens(ko, -5).mos, null, "no value without a positive P/E");
  assert.equal(buffettLens(buffettQuality(parseTimeseries(FX.KO), { sector: "Real Estate" }), 20).verdict, "Not assessed");
  assert.equal(kindOf("Banks"), "fin");
  assert.match(buffettQuality({ years: ["2025"] }, { sector: "Industrials" }).skip, /fewer than 3/);
});

test("value multiple", () => {
  assert.ok(Math.abs(valueMultiple(0) - (1 - Math.pow(1.1, -10)) / 0.1 - 1.025 / (0.075 * Math.pow(1.1, 10))) < 1e-9);
  assert.ok(valueMultiple(0.07) > valueMultiple(0));
});

test("rotation picks missing first and keeps values fresh", () => {
  const cache = { A: { date: "2026-11-01", q: { x: 1 } }, B: { date: "2026-06-01", q: { x: 2 } } };
  assert.deepEqual(pickBuffett(["A", "B", "C"], cache, "2026-11-11"), ["C", "B"]);
  assert.deepEqual(pickBuffett(["A", "B", "C"], cache, "2026-11-11", 5, ["B"]), ["B", "C"], "picks and bench first");
  assert.deepEqual(freshQ(cache, "A", "2026-11-11"), { x: 1 });
  assert.equal(freshQ(cache, "Z", "2026-11-11"), null);
});

// --- Buffett book ----------------------------------------------------------------
const L = (o) => ({ verdict: "Buffett buy zone", quality: true, mos: 0.3, ticker: o.s, name: o.s, sector: "S1", market: "US", ...o });

test("Buffett book: buys the biggest margins of safety, 10% each, sector cap", () => {
  let b = newBuffettBook();
  assert.equal(reviewDue(b, "2026-11-30"), false);
  assert.equal(reviewDue(b, "2026-12-01"), true);
  const lens = { A: L({ s: "A", mos: 0.5 }), B: L({ s: "B", mos: 0.4 }), C: L({ s: "C", mos: 0.35 }), D: L({ s: "D", mos: 0.6 }), E: L({ s: "E", mos: 0.3, sector: "S2" }), F: { verdict: "Wonderful, not cheap", quality: true, mos: 0.1, sector: "S2" } };
  b = review(b, lens, "2026-12-01");
  assert.deepEqual(b.pending.map((o) => o.symbol), ["D", "A", "B", "E"], "C is the fourth in sector S1");
  const mixed = review(newBuffettBook(), { X: L({ s: "X", sector: "Banks", mos: 0.9 }), Y: L({ s: "Y", sector: "Financials", mos: 0.8 }), Z: L({ s: "Z", sector: "Financial Services", mos: 0.7 }), W: L({ s: "W", sector: "Financials", mos: 0.6 }) }, "2026-12-01");
  assert.equal(mixed.pending.length, 3, "UK banks and US financials share one sector cap");
  assert.ok(b.pending.every((o) => o.amount === 1000));
  assert.equal(b.lastReview, "2026-12");
  const rows = Object.fromEntries(["A", "B", "D", "E"].map((s) => [s, [{ date: "2026-12-01", open: 9, close: 10 }, { date: "2026-12-02", open: 10, close: 11 }]]));
  b = fillOrders(b, rows);
  assert.equal(b.pending.length, 0);
  assert.equal(b.positions.length, 4);
  assert.equal(b.cash, 6000);
  assert.equal(b.positions[0].entry, 10, "filled at the next open, not the review close");
  b = markBuffett(b, rows, "2026-12-02");
  // 4 x (1000 - 1.5 fee) x 1.1 + 6000
  assert.equal(b.value, 10393.4);
  assert.equal(b.curve.length, 1);
  const s = buffettSummary(b);
  assert.equal(s.start, "2026-12-02");
  assert.equal(s.holdings.length, 4);
});

test("Buffett book sells only on a failed test or a price far above value", () => {
  let b = newBuffettBook();
  b = fillOrders(review(b, { A: L({ s: "A" }), B: L({ s: "B", sector: "S2" }), C: L({ s: "C", sector: "S3" }) }, "2026-12-01"),
    { A: [{ date: "2026-12-02", open: 10, close: 10 }], B: [{ date: "2026-12-02", open: 10, close: 10 }], C: [{ date: "2026-12-02", open: 10, close: 10 }] });
  const lens = { A: { ...L({ s: "A" }), quality: false, verdict: "Fails 1 test" }, B: L({ s: "B", sector: "S2", mos: -0.6, verdict: "Wonderful, not cheap" }), C: L({ s: "C", sector: "S3", mos: -0.2, verdict: "Wonderful, not cheap" }) };
  b = review(b, lens, "2027-01-04");
  assert.deepEqual(b.pending.filter((o) => o.side === "sell").map((o) => o.symbol), ["A", "B"]);
  assert.match(b.pending[0].why, /failed a test/);
  assert.match(b.pending[1].why, /60% above/);
  b = fillOrders(b, { A: [{ date: "2027-01-05", open: 5, close: 5 }], B: [{ date: "2027-01-05", open: 20, close: 20 }] });
  assert.equal(b.positions.map((p) => p.symbol).join(), "C");
  assert.equal(b.trades.filter((t) => t.side === "sell").length, 2);
  assert.ok(bookValue(b) > 0);
});

// --- Momentum book ---------------------------------------------------------------
const bars = (from, n, f) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.parse(from) + i * 86400000 * 7); return { date: d.toISOString().slice(0, 10), open: f(i), close: f(i) }; });

test("momentum book: month view, 12-1 return and the trend filter", () => {
  const rows = bars("2025-10-06", 62, (i) => 100 + i);
  const v = monthView(rows, "2026-12");
  assert.equal(v.ends.at(-1).month, "2026-11");
  assert.ok(v.open > 0);
  assert.ok(mom121(v.ends) > 0);
  assert.equal(mom121(v.ends.slice(-5)), null);
  assert.equal(trendUp(v.ends), true);
  assert.equal(trendUp(v.ends.map((x, i) => ({ ...x, close: 200 - i }))), false);
});

test("momentum book: rebalances once a month at the open, with costs, then marks", () => {
  let b = newMomentumBook(), mk = b.markets.US;
  assert.equal(rebalanceDue(mk, "2026-11-30"), false);
  assert.equal(rebalanceDue(mk, "2026-12-01"), true);
  const mkEnds = (g) => Array.from({ length: 14 }, (_, i) => ({ month: `x${i}`, close: 100 * Math.pow(1 + g, i) }));
  const cands = ["A", "B", "C"].map((s, i) => ({ symbol: s, ticker: s, ends: mkEnds(0.01 * (i + 1)), open: 50 }));
  const picks = rankMomentum(cands, 2);
  assert.deepEqual(picks.map((p) => p.symbol), ["C", "B"]);
  mk = rebalance(mk, { month: "2026-12", date: "2026-12-01", picks, opens: { B: 50, C: 50 }, cost: 0.003, trend: true });
  assert.equal(mk.positions.length, 2);
  assert.equal(mk.value, 9985, "10,000 traded at 0.15%");
  assert.equal(rebalanceDue(mk, "2026-12-15"), false);
  mk = markBook(mk, { B: { date: "2026-12-02", close: 55 }, C: { date: "2026-12-02", close: 50 } }, "2026-12-02");
  assert.equal(mk.value, 10484.25);
  // Trend down: all to cash.
  mk = rebalance(mk, { month: "2027-01", date: "2027-01-04", picks: [], opens: { B: 55, C: 50 }, cost: 0.003, trend: false });
  assert.equal(mk.positions.length, 0);
  assert.ok(mk.cash > 10400 && mk.cash < 10484.25);
  assert.equal(mk.rebalances.at(-1).sold.length, 2);
  const s = bookSummary(mk);
  assert.equal(s.start, "2026-12-01");
});
