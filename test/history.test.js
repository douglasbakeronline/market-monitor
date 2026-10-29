import { test } from "node:test";
import assert from "node:assert/strict";
import { logSignals, evaluate, summarise } from "../src/trackRecord.js";
import { recordScores, scoreChange, recordEarnings, lastReaction } from "../src/stockHistory.js";

const rows = (start, closes) => closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10), close: c }));

test("signals are logged once per kind, symbol and day", () => {
  const e = { kind: "buy", at: "2026-10-01T12:00:00Z", date: "2026-10-01", symbol: "^GSPC", price: 100 };
  const log = logSignals(logSignals([], [e]), [e, { ...e, kind: "watch" }]);
  assert.equal(log.length, 2);
});

test("evaluate scores returns at horizons and against the S&P", () => {
  const sp = rows("2026-01-01", Array.from({ length: 80 }, (_, i) => 100 + i * 0.5));
  const stock = rows("2026-01-01", Array.from({ length: 80 }, (_, i) => 50 + i));
  const [s] = evaluate([{ id: "x", kind: "research-lt", date: "2026-01-01", symbol: "X", price: 50 }], { X: stock }, sp);
  assert.equal(s.perf.w1, 10);
  assert.equal(s.perf.m1, 42);
  assert.ok(s.perf.vsSp > 0);
  assert.equal(s.perf.sessions, 79);
});

test("for greed and trim, a fall afterwards counts as right", () => {
  const log = [
    { kind: "greed", perf: { now: -3, vsSp: 0, sessions: 6 } },
    { kind: "buy", perf: { now: 4, vsSp: 1, sessions: 6 } },
    { kind: "research-lt", perf: { now: -2, vsSp: -1, sessions: 6 } },
    { kind: "buy", perf: { now: 9, vsSp: 9, sessions: 2 } },
  ];
  const s = summarise(log);
  assert.equal(s.basis, "now");
  assert.equal(s.hitRate, 67);
});

test("missing price rows keep earlier results", () => {
  const prev = { id: "x", kind: "buy", date: "2026-01-01", symbol: "Y", price: 1, perf: { now: 5 } };
  assert.deepEqual(evaluate([prev], {}, null)[0].perf, { now: 5 });
});

test("score history keeps one point per day and measures weekly change", () => {
  let s = recordScores({}, [{ symbol: "A", longTerm: { score: 60 }, swing: { score: 50 } }], "2026-10-20");
  s = recordScores(s, [{ symbol: "A", longTerm: { score: 70 }, swing: { score: 40 } }], "2026-10-28");
  s = recordScores(s, [{ symbol: "A", longTerm: { score: 72 }, swing: { score: 45 } }], "2026-10-28");
  assert.equal(s.A.length, 2);
  assert.deepEqual(scoreChange(s.A, "2026-10-28"), { lt: 12, sw: -5, since: "2026-10-20" });
});

test("earnings reaction spans the results day (before or after the bell)", () => {
  const r = [{ date: "2026-10-27", close: 100 }, { date: "2026-10-28", close: 98 }, { date: "2026-10-29", close: 88 }];
  const e = recordEarnings({}, "G", "2026-10-28");
  assert.deepEqual(lastReaction(e.G, r, "2026-10-29"), { date: "2026-10-28", pending: false, pct: -12, from: "2026-10-27", to: "2026-10-29" });
  assert.equal(lastReaction(["2026-10-29"], r, "2026-10-29").pending, true);
  assert.equal(lastReaction(["2026-11-05"], r, "2026-10-29"), null, "future dates are not reactions");
});

test("signals younger than a week are not scored", () => {
  assert.equal(summarise([{ kind: "buy", perf: { now: 1, sessions: 2 } }]).hitRate, null);
});
