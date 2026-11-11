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
  assert.match(usPeer.note, /EV\/EBITDA 10\.9 vs the US Industrials median of 14\.5 \(10 stocks\): 25% below\./);
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

// --- EV/EBITDA in the score (since 11 Nov) ---
import { withEv } from "../src/evSample.js";
import { longTermLive } from "../src/research.js";
import { peerFor } from "../src/sectorValue.js";

const fBase = { sector: "Industrials", industry: "Specialty Industrial Machinery", forwardPE: 18, trailingPE: 20, peg: 1.4, evToEbitda: 30,
  profitMargin: 0.18, roe: 0.22, revenueGrowth: 0.1, earningsGrowth: 0.12, debtToEquity: 60, targetMean: 120, recommendationMean: 2, analysts: 20 };
const tBase = { last: 100, offHigh: -8, vs200: 2, rsi: 48, mom12_1: 20, sma50: 98, sma200: 95 };
const med = { forwardPE: 20, trailingPE: 22, pe: 20, n: 40 };
const peerOf = (f) => peerFor(f, { Industrials: med }, null, "US");
const evItem = (r) => r.pillars.find((p) => p.key === "value").items.find((i) => i.key === "evToEbitda");
const value = (r) => r.pillars.find((p) => p.key === "value").score;

test("EV/EBITDA is scored against its sector median: 30x near a median of 28 is fair, not poor", () => {
  const peer = peerOf(fBase);
  const fixed = longTermLive(fBase, tBase, peer);
  const { f, peer: p2 } = withEv(fBase, peer, { ev: 30, median: 28 });
  const rel = longTermLive(f, tBase, p2);
  assert.ok(evItem(fixed).score < 30, "poor on the fixed bands");
  assert.ok(evItem(rel).score >= 50, "about par against peers");
  assert.match(evItem(rel).display, /sector 28\.0/);
  assert.ok(value(rel) > value(fixed));
});

test("quick scores gain the sample EV/EBITDA; no peer value leaves the score unchanged", () => {
  const quick = { ...fBase, evToEbitda: null };
  const peer = peerOf(quick);
  const before = longTermLive(quick, tBase, peer);
  assert.equal(evItem(before).score, null);
  const { f, peer: p2 } = withEv(quick, peer, { ev: 8, median: 16 });
  const after = longTermLive(f, tBase, p2);
  assert.ok(evItem(after).score > 80, "half the sector median is cheap");
  assert.ok(value(after) > value(before));
  assert.deepEqual(withEv(quick, peer, null), { f: quick, peer });
  assert.deepEqual(withEv(quick, null, { ev: 8, median: 16 }), { f: quick, peer: null });
});

test("cyclicals keep the value cap with EV/EBITDA in", () => {
  const f0 = { ...fBase, sector: "Information Technology", industry: "Semiconductors", forwardPE: 6, trailingPE: 7 };
  const peer = peerFor(f0, { "Information Technology": med }, null, "US");
  const { f, peer: p2 } = withEv(f0, peer, { ev: 5, median: 20 });
  const r = longTermLive(f, tBase, p2);
  assert.equal(value(r), 60);
});
