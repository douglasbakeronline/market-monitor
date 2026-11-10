import { test } from "node:test";
import assert from "node:assert/strict";
import { driftEvents, analyseDrift, HORIZONS } from "../src/driftStudy.js";

function bars(n, f = (i) => 100 * Math.pow(1.0004, i) * (1 + 0.01 * Math.sin(i / 4))) {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { date: new Date(Date.UTC(2017, 0, 1) + i * 86400000).toISOString().slice(0, 10), open: c, high: c, low: c, close: c, volume: 1e6 };
  });
}

test("up and down events on 3x volume with forward returns after costs from the next open", () => {
  const rows = bars(400);
  rows[300] = { ...rows[300], close: rows[299].close * 1.06, open: rows[299].close * 1.03, volume: 4e6 };
  rows[330] = { ...rows[330], close: rows[329].close * 0.94, volume: 4e6 };
  rows[340] = { ...rows[340], close: rows[339].close * 0.94 }; // no volume: not an event
  const idx = new Map(rows.map((r) => [r.date, 1000 + rows.indexOf(r)]));
  const ev = driftEvents(rows, "US", { idx, seed: 2 });
  const up = ev.filter((e) => e.kind === "up"), down = ev.filter((e) => e.kind === "down");
  assert.equal(up.length, 1);
  assert.equal(down.length, 1);
  assert.equal(up[0].date, rows[300].date);
  assert.equal(up[0].move, 6);
  assert.equal(up[0].gap, 3);
  assert.equal(up[0].regimeUp, true);
  const want = ((rows[301 + 20 - 1].close / rows[301].open - 1) - 0.003) * 100;
  assert.ok(Math.abs(up[0].f[20] - want) < 0.01);
  assert.equal(down[0].f[60] != null, true);
  assert.ok(ev.some((e) => e.kind === "random"));
  // Events near the end have no long horizons.
  const late = bars(320); late[300] = { ...late[300], close: late[299].close * 1.05, volume: 5e6 };
  const e2 = driftEvents(late, "UK").find((e) => e.kind === "up");
  assert.equal(e2.f[60], null);
  assert.ok(e2.f[5] != null);
});

test("analyseDrift: hypotheses pass only when every check holds", () => {
  const mk = (kind, v, year, market = "US", extra = {}) => ({ kind, year, market, date: `${year}-06-01`, move: 5, gap: 1, regimeUp: true, f: Object.fromEntries(HORIZONS.map((h) => [h, v])), ...extra });
  const all = [];
  for (const y of ["2018", "2019", "2020", "2022", "2023", "2024"]) for (let i = 0; i < 60; i++) {
    all.push(mk("up", 2 + (i % 3), y), mk("random", 1 + (i % 3), y), mk("down", 0 + (i % 3), y));
    all.push(mk("up", 2 + (i % 3), y, "UK"), mk("random", 1 + (i % 3), y, "UK"), mk("down", 0 + (i % 3), y, "UK"));
  }
  const a = analyseDrift(all);
  assert.equal(a.H1.pass, true);
  assert.equal(a.H1.edge, 1);
  assert.equal(a.H2.pass, true);
  assert.equal(a.H3.pass, true);
  assert.equal(a.up.length, HORIZONS.length);
  assert.equal(a.explore.length, 7);
  // Flip the UK up events negative: H1 and H2 fail on markets.
  const b = analyseDrift(all.map((e) => (e.kind === "up" && e.market === "UK" ? { ...e, f: Object.fromEntries(HORIZONS.map((h) => [h, -5])) } : e)));
  assert.equal(b.H1.checks.markets, false);
  assert.equal(b.H2.pass, false);
});
