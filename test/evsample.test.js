import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRefresh, record, prune, evMedians, evPeer, freshEv, cleanEv, PER_NIGHT } from "../src/evSample.js";

const today = "2026-11-10";

test("refresh order: never fetched first, then oldest; nothing refreshed within a week", () => {
  const cache = { A: { ev: 10, date: "2026-11-08" }, B: { ev: 12, date: "2026-10-01" }, C: { ev: 9, date: "2026-10-20" } };
  assert.deepEqual(pickRefresh(["A", "B", "C", "D"], cache, today), ["D", "B", "C"]);
  assert.deepEqual(pickRefresh(["A", "B", "C", "D"], cache, today, 2), ["D", "B"]);
  const many = Array.from({ length: 300 }, (_, i) => `S${i}`);
  assert.equal(pickRefresh(many, {}, today).length, PER_NIGHT);
});

test("values: negative, missing or absurd multiples are stored as null (fetched, nothing to use)", () => {
  assert.equal(cleanEv(8.26), 8.3);
  assert.equal(cleanEv(-4), null);
  assert.equal(cleanEv(null), null);
  assert.equal(cleanEv(950), null);
  const c = record({}, "X", -3, today);
  assert.deepEqual(c.X, { ev: null, date: today });
  assert.deepEqual(pickRefresh(["X"], c, today), [], "not fetched again tomorrow");
});

test("prune drops companies that left the universe", () => {
  assert.deepEqual(Object.keys(prune({ A: {}, B: {} }, ["A"])), ["A"]);
});

test("freshEv ignores values older than 45 days", () => {
  const c = { A: { ev: 10, date: "2026-10-01" }, B: { ev: 10, date: "2026-09-01" } };
  assert.equal(freshEv(c, "A", today), 10);
  assert.equal(freshEv(c, "B", today), null);
  assert.equal(freshEv(c, "Z", today), null);
});

const universe = (n, sector, market, evs) => Array.from({ length: n }, (_, i) => ({ symbol: `${market}${sector}${i}`, sector, market, ev: evs(i) }));
const cacheOf = (rows, date = today) => Object.fromEntries(rows.filter((r) => r.ev !== undefined).map((r) => [r.symbol, { ev: r.ev, date }]));

test("no medians until 60% of the universe is fresh", () => {
  const rows = universe(20, "Industrials", "US", (i) => (i < 11 ? 10 + i : undefined));
  const m = evMedians(rows, cacheOf(rows), today);
  assert.equal(m.coverage, 55);
  assert.equal(m.ready, false);
  assert.deepEqual(m.US, {});
  assert.equal(evPeer(12, "Industrials", "US", m), null);
});

test("sector medians by region with a pooled fallback; Financials and trusts left out", () => {
  const us = universe(10, "Industrials", "US", (i) => 10 + i); // median 14.5
  const eu = universe(5, "Industrials", "UK", (i) => 6 + i); // too few for Europe alone
  const fin = universe(10, "Financials", "US", () => 9);
  const trust = [{ symbol: "PCT", sector: "Closed End Investments", market: "UK", trust: true, ev: 3 }];
  const rows = [...us, ...eu, ...fin, ...trust];
  const m = evMedians(rows, cacheOf(rows), today);
  assert.equal(m.ready, true);
  assert.equal(m.coverage, 100, "trusts don't count towards coverage");
  assert.deepEqual(m.US.Industrials, { ev: 14.5, n: 10 });
  assert.equal(m.Europe.Industrials, undefined);
  assert.deepEqual(m.pooled.Industrials, { ev: 12, n: 15 });
  assert.equal(m.US.Financials, undefined);

  const usPeer = evPeer(10.9, "Industrials", "US", m);
  assert.equal(usPeer.region, "US");
  assert.match(usPeer.note, /EV\/EBITDA 10\.9 vs the US Industrials median of 14\.5 \(10 stocks\): 25% below \(not in the score yet\)\./);
  const ukPeer = evPeer(12.3, "Industrial Engineering", "UK", m);
  assert.equal(ukPeer.region, null, "falls back to the pooled median");
  assert.match(ukPeer.note, /vs the Industrials median of 12\.0 \(15 stocks\): in line with peers/);
  assert.equal(evPeer(9, "Banks", "UK", m), null, "no EV/EBITDA view for banks");
  assert.equal(evPeer(null, "Industrials", "US", m), null);
});

test("stale values count neither for coverage nor medians", () => {
  const rows = universe(10, "Industrials", "US", (i) => 10 + i);
  const m = evMedians(rows, cacheOf(rows, "2026-09-01"), today);
  assert.equal(m.coverage, 0);
  assert.equal(m.ready, false);
});

// --- EV view (display only) ---
import { evView, evViewSummary } from "../src/evSample.js";
import { longTermLive } from "../src/research.js";
import { peerFor } from "../src/sectorValue.js";

const fBase = { sector: "Industrials", industry: "Specialty Industrial Machinery", forwardPE: 18, trailingPE: 20, peg: 1.4, evToEbitda: 30,
  profitMargin: 0.18, roe: 0.22, revenueGrowth: 0.1, earningsGrowth: 0.12, debtToEquity: 60, targetMean: 120, recommendationMean: 2, analysts: 20 };
const tBase = { last: 100, offHigh: -8, vs200: 2, rsi: 48, mom12_1: 20, sma50: 98, sma200: 95 };
const med = { forwardPE: 20, trailingPE: 22, pe: 20, n: 40 };
const peerOf = (f) => peerFor(f, { Industrials: med }, null, "US");

test("EV view: a high EV/EBITDA in a richly valued sector scores better against peers than on the fixed bands", () => {
  const peer = peerOf(fBase), live = longTermLive(fBase, tBase, peer);
  const ep = { ev: 30, median: 28 };
  const v = evView(fBase, tBase, peer, ep, live);
  const evItem = (r) => r.pillars.find((p) => p.key === "value").items.find((i) => i.key === "evToEbitda");
  assert.ok(evItem(live).score < 30, "30x is poor on the fixed bands");
  assert.ok(v.value > v.valueNow, "near its sector median, value improves");
  assert.ok(v.score >= v.scoreNow);
  assert.equal(v.scoreNow, live.score);
  assert.match(v.note, /Scoring EV\/EBITDA against peers would/);
});

test("EV view: quick-scored stocks gain the sample EV/EBITDA; nothing for missing peers or unscored", () => {
  const quick = { ...fBase, evToEbitda: null };
  const peer = peerOf(quick), live = longTermLive(quick, tBase, peer);
  assert.ok(!live.pillars.find((p) => p.key === "value").items.some((i) => i.key === "evToEbitda" && i.score != null));
  const v = evView(quick, tBase, peer, { ev: 8, median: 16 }, live);
  assert.ok(v.value > v.valueNow, "a cheap sample multiple lifts value");
  assert.equal(evView(fBase, tBase, null, { ev: 8, median: 16 }, live), null);
  assert.equal(evView(fBase, tBase, peer, null, live), null);
  assert.equal(evView(fBase, tBase, peer, { ev: 8, median: 16 }, { score: null }), null);
});

test("EV view summary counts changed verdicts and lists moves into and out of Good entry", () => {
  const view = (now, to, s0, s1) => ({ verdictNow: now, verdict: to, scoreNow: s0, score: s1, changed: now !== to });
  const s = evViewSummary([
    { symbol: "A", view: view("Fair", "Good entry", 71, 73), deep: true },
    { symbol: "B", view: view("Good entry", "Fair", 73, 70) },
    { symbol: "C", view: view("Fair", "Fair", 60, 60) },
    { symbol: "D", view: null },
  ]);
  assert.equal(s.n, 3);
  assert.equal(s.changed, 2);
  assert.deepEqual(s.toGood, ["A"]);
  assert.deepEqual(s.fromGood, ["B"]);
  assert.equal(s.up, 1);
  assert.equal(s.down, 1);
  assert.equal(s.moves["Fair → Good entry"], 1);
  assert.equal(s.full, 1);
  assert.equal(s.changedFull, 1);
});
