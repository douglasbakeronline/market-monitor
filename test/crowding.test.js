import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyReturns, correlation, moveTogether, movesWith, crowdingNote, planOverlap, planOverlapNote } from "../src/crowding.js";

// Build a rebased series (cumulative %) from daily returns.
const series = (rets) => { const out = [0]; let v = 1; for (const r of rets) { v *= 1 + r; out.push(Math.round((v - 1) * 10000) / 100); } return out; };
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const noise = (n, s = 0.02) => Array.from({ length: n }, () => rnd() * s);
const mix = (a, b, w) => a.map((v, i) => w * v + (1 - w) * b[i]);
const item = (symbol, rets, extra = {}) => ({ symbol, market: "US", date: "2026-11-11", sector: "Tech", industry: "Chips", series: series(rets), longTerm: { verdict: "Good entry" }, ...extra });

test("dailyReturns undoes the rebase", () => {
  const r = dailyReturns(series([0.01, -0.02, 0.03]));
  assert.equal(r.length, 3);
  assert.ok(Math.abs(r[0] - 0.01) < 1e-4 && Math.abs(r[1] + 0.02) < 1e-4 && Math.abs(r[2] - 0.03) < 1e-4);
  assert.deepEqual(dailyReturns([0]), []);
  assert.deepEqual(dailyReturns([0, null, 2]), []);
  assert.deepEqual(dailyReturns(undefined), []);
});

test("correlation: identical, opposite, too short", () => {
  const a = noise(60);
  assert.ok(Math.abs(correlation(a, a) - 1) < 1e-9);
  assert.ok(Math.abs(correlation(a, a.map((v) => -v)) + 1) < 1e-9);
  assert.equal(correlation([1, 2], [1, 2]), null);
  assert.equal(correlation(Array(20).fill(0.01), noise(20)), null, "flat series has no correlation");
});

test("moveTogether groups a shared shock and leaves the others alone", () => {
  const f = noise(120);
  const items = [
    item("A", mix(f, noise(120), 0.9)), item("B", mix(f, noise(120), 0.9)), item("C", mix(f, noise(120), 0.85)),
    item("D", noise(120), { sector: "Banks" }), item("E", noise(120), { sector: "Health" }),
  ];
  const g = moveTogether(items);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].symbols.sort(), ["A", "B", "C"]);
  assert.ok(g[0].avgCorr > 0.6);
  assert.equal(g[0].sector, "Tech");
  assert.equal(g[0].allSector, true);
});

test("different markets or dates are never compared", () => {
  const f = noise(120);
  const items = [item("A", f), item("B", f, { market: "UK" }), item("C", f, { date: "2026-11-10" })];
  assert.equal(moveTogether(items).length, 0);
  assert.deepEqual(movesWith(items[0], items), []);
});

test("short history is skipped", () => {
  const f = noise(30);
  assert.equal(moveTogether([item("A", f), item("B", f)]).length, 0);
});

test("movesWith lists the closest peers, strongest first, capped", () => {
  const f = noise(120);
  const items = ["A", "B", "C", "D", "E", "F"].map((s, i) => item(s, mix(f, noise(120), 0.95 - i * 0.02)));
  const m = movesWith(items[0], items);
  assert.equal(m.length, 4);
  assert.ok(m.every((x, i) => i === 0 || m[i - 1].corr >= x.corr));
  assert.ok(!m.some((x) => x.symbol === "A"));
});

test("crowdingNote says how many separate ideas there are", () => {
  const f = noise(120);
  const items = [
    item("A", mix(f, noise(120), 0.9)), item("B", mix(f, noise(120), 0.9)), item("C", mix(f, noise(120), 0.9)),
    item("D", noise(120)), item("E", noise(120)), item("F", noise(120), { longTerm: { verdict: "Fair" } }),
  ];
  const n = crowdingNote(items);
  assert.equal(n.good, 5);
  assert.equal(n.ideas, 3);
  assert.match(n.text, /^3 of the 5 good entries move together/);
  assert.match(n.text, /about three separate ideas, not five\.$/);
  assert.match(n.text, /\(all Tech\)/);
});

test("crowdingNote stays quiet when good entries are few or unrelated", () => {
  assert.equal(crowdingNote([]), null);
  assert.equal(crowdingNote([item("A", noise(120)), item("B", noise(120))]), null);
  assert.equal(crowdingNote(["A", "B", "C", "D"].map((s) => item(s, noise(120)))), null);
});

test("planOverlap: pick pairs once, bench against picks only, picks first", () => {
  const f = noise(120), g = noise(120);
  const items = [
    item("P1", mix(f, noise(120), 0.9)), item("P2", mix(f, noise(120), 0.9)), item("P3", noise(120)),
    item("B1", mix(g, noise(120), 0.9)), item("B2", mix(g, noise(120), 0.9)), item("B3", mix(f, noise(120), 0.9)),
  ];
  // B1 and B2 move together but neither is a pick: not reported.
  const o = planOverlap(items, ["P1", "P2", "P3", "MISSING"], ["B1", "B2", "B3"]);
  assert.equal(o.filter((x) => x.pick).length, 1);
  assert.equal(o[0].pick, true);
  assert.deepEqual(o.filter((x) => !x.pick).map((x) => x.a), ["B3", "B3"].slice(0, o.filter((x) => !x.pick).length));
  assert.ok(!o.some((x) => x.a === "B1" || x.a === "B2"));
  const n = planOverlapNote(o);
  assert.match(n, /^Picks that move together: P1 with P2 \(0\.\d\d\)/);
  assert.match(n, /Bench names that move with a pick: B3 with P/);
  assert.equal(planOverlapNote([]), null);
});
