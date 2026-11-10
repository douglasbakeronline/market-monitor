import { test } from "node:test";
import assert from "node:assert/strict";
import { swingBook } from "../src/swingBook.js";

const T = (id, entryDate, score, r, exitDate, extra = {}) => ({ id, symbol: id, ticker: id, market: "US", entryDate, entry: 100, risk: 5, stop: 95, target: 110, score, status: exitDate ? "closed" : "open", r, exitDate, exit: exitDate ? 100 + 5 * r : undefined, ...extra });

test("four slots, best score first, 2% risk, costs in R", () => {
  const log = [
    T("A", "2026-11-02", 70, 2, "2026-11-05"), T("B", "2026-11-02", 90, -1, "2026-11-04"), T("C", "2026-11-02", 80, 1, "2026-11-06"),
    T("D", "2026-11-02", 60, 0.5, "2026-11-06"), T("E", "2026-11-02", 75, 2, "2026-11-06"),
  ];
  const b = swingBook(log, () => 0.1);
  assert.deepEqual(b.recent.map((x) => x.symbol).sort(), ["A", "B", "C", "E"], "D (lowest score) skipped");
  assert.equal(b.skipped, 1);
  // Position cap: risk 5 on entry 100 = 5%: 2% risk would be 40% of the book, capped at 25% -> risk £125.
  const a = b.recent.find((x) => x.symbol === "A");
  assert.equal(a.riskAmt, 125);
  assert.equal(a.pnl, 125 * (2 - 0.1));
  assert.ok(b.value > b.equity0);
  assert.equal(b.closed, 4);
});

test("a freed slot takes a later entry; open trades marked to market; orders fill free slots", () => {
  const log = [
    T("A", "2026-11-02", 70, -1, "2026-11-03"), T("B", "2026-11-03", 60, null, null, { openR: 0.5, lastPrice: 102.5 }),
    { id: "P1", symbol: "P1", ticker: "P1", status: "pending", score: 80, signalDate: "2026-11-09", signalPrice: 50, stop: 47 },
    { id: "P2", symbol: "P2", ticker: "P2", status: "pending", score: 90, signalDate: "2026-11-09", signalPrice: 50, stop: 45 },
  ];
  const b = swingBook(log, () => 0, { maxOpen: 2 });
  assert.equal(b.open.length, 1);
  assert.equal(b.open[0].symbol, "B");
  assert.ok(b.open[0].openPnl > 0);
  assert.deepEqual(b.orders.map((x) => x.symbol), ["P2"], "one free slot, best score");
  assert.equal(b.waiting, 1);
});

test("pauses after a 25% fall", () => {
  const log = Array.from({ length: 20 }, (_, i) => T(`S${i}`, `2026-11-${String(2 + i).padStart(2, "0")}`, 70, -1, `2026-11-${String(2 + i).padStart(2, "0")}`, { entry: 100, risk: 25, stop: 75 }));
  const b = swingBook(log, () => 0, { riskPct: 10, maxPosPct: 100 });
  assert.equal(b.paused, true);
  assert.ok(b.skipped > 0);
  assert.equal(b.orders.length, 0);
});

test("digest line", async () => {
  const { bookLine } = await import("../src/swingBook.js");
  assert.equal(bookLine({ start: "2026-11-02", returnPct: -2.42, sp: { pct: 1.07 }, open: [1, 2, 3, 4], closed: 2, avgNetR: -1.05 }), "Swing book (paper): -2.4% since 2 Nov (S&P 500 +1.1%); 4 open, 2 closed, average -1.05R after costs.");
  assert.equal(bookLine(null), null);
});
