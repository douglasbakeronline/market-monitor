import { test } from "node:test";
import assert from "node:assert/strict";
import { shortPot } from "../src/shortPot.js";

const tr = (o) => ({ market: "US", name: o.symbol, ticker: o.symbol, signalPrice: 10, ...o, id: `${o.signalDate}:${o.kind}:${o.symbol}` });

test("shortPot: drift before bounces, five slots of a fifth, buys from pending, sells at the latest close", () => {
  const log = [
    tr({ kind: "bounce", symbol: "B1", signalDate: "2026-11-11", status: "closed", entryDate: "2026-11-12", entry: 10, exitDate: "2026-11-13", exit: 10.5, netPct: 4.7 }),
    tr({ kind: "drift", symbol: "D1", signalDate: "2026-11-11", status: "open", entryDate: "2026-11-12", entry: 10, netPct: 2, sessions: 2, volX: 3 }),
    tr({ kind: "bounce", symbol: "B0", signalDate: "2026-11-10", status: "closed", entryDate: "2026-11-11", entry: 10, exitDate: "2026-11-12", exit: 11, netPct: 9.7 }),
    tr({ kind: "bounce", symbol: "P1", signalDate: "2026-11-13", status: "pending", rsi2: 3 }),
    tr({ kind: "drift", symbol: "P2", signalDate: "2026-11-13", status: "pending", volX: 4 }),
  ];
  const p = shortPot(log, { today: "2026-11-13" });
  assert.equal(p.start, "2026-11-12", "signals before the start date are ignored");
  assert.equal(p.closed, 1);
  assert.equal(p.value, 10000 + 2000 * 0.047 + 2000 * 0.02);
  assert.deepEqual(p.sells.map((x) => x.ticker), ["B1"]);
  assert.deepEqual(p.buys.map((x) => x.ticker), ["P2", "P1"], "drift first");
  assert.equal(p.free, 4);
});

test("shortPot: full slots skip signals; a 25% fall pauses new buys", () => {
  const open = Array.from({ length: 5 }, (_, k) => tr({ kind: "drift", symbol: `O${k}`, signalDate: "2026-11-11", status: "open", entryDate: "2026-11-12", entry: 10, netPct: 0 }));
  const p = shortPot([...open, tr({ kind: "drift", symbol: "X", signalDate: "2026-11-11", status: "open", entryDate: "2026-11-12", entry: 10, netPct: 0 }), tr({ kind: "bounce", symbol: "Q", signalDate: "2026-11-13", status: "pending" })]);
  assert.equal(p.open.length, 5, "sixth same-day signal not taken");
  assert.equal(p.buys.length, 0);
  assert.equal(p.skipped, 1);
  const crash = Array.from({ length: 5 }, (_, k) => tr({ kind: "drift", symbol: `C${k}`, signalDate: "2026-11-11", status: "closed", entryDate: "2026-11-12", entry: 10, exitDate: "2026-12-10", exit: 4, netPct: -60 }));
  const q = shortPot([...crash, tr({ kind: "drift", symbol: "N", signalDate: "2026-12-10", status: "pending" })]);
  assert.equal(q.paused, true);
  assert.equal(q.buys.length, 0);
});

test("shortPot: scarce slots go to results days, then the bigger EPS beat, then volume (12 Nov)", () => {
  const open = Array.from({ length: 3 }, (_, k) => tr({ kind: "drift", symbol: `O${k}`, signalDate: "2026-11-11", status: "open", entryDate: "2026-11-12", entry: 10, netPct: 0 }));
  const pend = [
    tr({ kind: "drift", symbol: "VOL", signalDate: "2026-11-13", status: "pending", results: false, volX: 9 }),
    tr({ kind: "drift", symbol: "SMALL", signalDate: "2026-11-13", status: "pending", results: true, surprisePct: 2, volX: 8 }),
    tr({ kind: "drift", symbol: "NONE", signalDate: "2026-11-13", status: "pending", results: true, surprisePct: null, volX: 7 }),
    tr({ kind: "drift", symbol: "BIG", signalDate: "2026-11-13", status: "pending", results: true, surprisePct: 15, volX: 3 }),
  ];
  const p = shortPot([...open, ...pend], { today: "2026-11-13" });
  assert.deepEqual(p.buys.map((x) => x.ticker), ["BIG", "SMALL"]);
  assert.equal(p.skipped, 2);
});
