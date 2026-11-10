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
