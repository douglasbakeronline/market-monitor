import { test } from "node:test";
import assert from "node:assert/strict";
import { addSetups, updateTrade, summarise } from "../src/paperTrades.js";

const bar = (date, open, high, low, close) => ({ date, open, high, low, close, volume: 1 });
const setup = { symbol: "AAA", ticker: "AAA", name: "A", market: "US", currency: "USD", price: 100, stop: 95, score: 70 };

test("setups become pending trades, one open trade per symbol", () => {
  let log = addSetups([], [setup], "2026-11-02");
  log = addSetups(log, [setup], "2026-11-03");
  assert.equal(log.length, 1);
  assert.equal(log[0].status, "pending");
});

test("entry at next open; target is 2R from the entry", () => {
  const [t0] = addSetups([], [setup], "2026-11-02");
  const t = updateTrade(t0, [bar("2026-11-02", 99, 101, 98, 100), bar("2026-11-03", 101, 102, 100, 101.5)]);
  assert.equal(t.status, "open");
  assert.equal(t.entry, 101);
  assert.equal(t.target, 113);
  assert.equal(t.openR, 0.08);
});

test("stop hit scores -1R; a gap below the stop fills at the open", () => {
  const [t0] = addSetups([], [setup], "2026-11-02");
  const hit = updateTrade(t0, [bar("2026-11-03", 100, 101, 94, 96)]);
  assert.equal(hit.reason, "stop");
  assert.equal(hit.r, -1);
  const gap = updateTrade(t0, [bar("2026-11-03", 100, 101, 99, 100), bar("2026-11-04", 90, 91, 89, 90)]);
  assert.equal(gap.reason, "stop");
  assert.equal(gap.exit, 90);
  assert.equal(gap.r, -2);
});

test("target hit scores +2R; both in one bar counts as the stop", () => {
  const [t0] = addSetups([], [setup], "2026-11-02");
  const win = updateTrade(t0, [bar("2026-11-03", 100, 101, 99, 100), bar("2026-11-04", 104, 111, 103, 110)]);
  assert.equal(win.reason, "target");
  assert.equal(win.r, 2);
  const both = updateTrade(t0, [bar("2026-11-03", 100, 111, 94, 100)]);
  assert.equal(both.reason, "stop");
});

test("time exit after 20 sessions at the close; open below stop voids", () => {
  const [t0] = addSetups([], [setup], "2026-11-02");
  const rows = Array.from({ length: 25 }, (_, i) => bar(`2026-12-${String(i + 1).padStart(2, "0")}`, 100, 101, 99, 102));
  const t = updateTrade(t0, rows);
  assert.equal(t.reason, "time");
  assert.equal(t.sessions, 20);
  assert.equal(t.r, 0.4);
  assert.equal(updateTrade(t0, [bar("2026-11-03", 94, 95, 93, 94)]).status, "void");
});

test("summary: win rate and expectancy in R", () => {
  const log = [{ status: "closed", r: 2, market: "US", reason: "target", signalDate: "2026-11-02" }, { status: "closed", r: -1, market: "UK", reason: "stop", signalDate: "2026-11-03" }, { status: "open", signalDate: "2026-11-04" }];
  const s = summarise(log);
  assert.equal(s.closed, 2); assert.equal(s.winRate, 50); assert.equal(s.avgR, 0.5); assert.equal(s.open, 1);
  assert.equal(s.us.avgR, 2); assert.equal(s.since, "2026-11-02");
});
