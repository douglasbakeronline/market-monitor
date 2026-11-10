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

test("random books: same rules, random choice; share beaten", async () => {
  const { randomBooks } = await import("../src/swingBook.js");
  // Best score always wins big, others lose: the ranked book beats random choice.
  const log = [];
  for (let d = 2; d < 20; d += 3) for (let k = 0; k < 6; k++) {
    const day = `2026-11-${String(d).padStart(2, "0")}`, out = `2026-11-${String(d + 2).padStart(2, "0")}`;
    log.push(T(`S${d}-${k}`, day, 60 + k * 5, k >= 4 ? 2 : -1, out));
  }
  const r = randomBooks(log, () => 0, { runs: 100, seed: 3 });
  assert.equal(r.runs, 100);
  assert.ok(r.beatShare >= 90, `beat ${r.beatShare}%`);
  assert.ok(r.median < r.mine);
});

test("benchmark series and book news", async () => {
  const { benchSeries, bookNews } = await import("../src/swingBook.js");
  const rows = [{ date: "2026-10-30", close: 100 }, { date: "2026-11-02", close: 101 }, { date: "2026-11-03", close: 99 }];
  assert.deepEqual(benchSeries(rows, "2026-11-02"), [{ date: "2026-11-02", pct: 1 }, { date: "2026-11-03", pct: -1 }]);
  const b = { start: "2026-11-02", returnPct: -2.4, orders: [{ signalDate: "2026-11-10", symbol: "GWW", ticker: "GWW", stopPct: 4.9 }], recent: [{ id: "x", ticker: "DASH", netR: -1.05, reason: "stop" }] };
  const first = bookNews(b, null);
  assert.equal(first.line, null, "first run is silent");
  assert.equal(bookNews(b, first.seen).line, null, "nothing new");
  const later = bookNews({ ...b, recent: [{ id: "y", ticker: "DE", netR: 1.9, reason: "target" }, ...b.recent] }, first.seen);
  assert.equal(later.line, "closed: DE +1.9R (target). Book -2.4% since 2 Nov.");
  const ord = bookNews({ ...b, orders: [{ signalDate: "2026-11-11", symbol: "MSFT", ticker: "MSFT", stopPct: 3.1 }] }, first.seen);
  assert.match(ord.line, /^buy at the next open: MSFT \(stop 3\.1% below\)/);
});

test("paper trades keep why a setup fired, and the book passes it on", async () => {
  const { addSetups } = await import("../src/paperTrades.js");
  const { swingBook } = await import("../src/swingBook.js");
  const log = addSetups([], [{ symbol: "MSFT", ticker: "MSFT", price: 100, stop: 95, score: 80, why: ["Breakout", "MACD cross up"] }], "2026-11-10");
  assert.deepEqual(log[0].why, ["Breakout", "MACD cross up"]);
  assert.deepEqual(swingBook(log).orders[0].why, ["Breakout", "MACD cross up"]);
});

test("swing-trade alerts: orders with stop and target, closes, nothing when quiet", async () => {
  const { bookNews, swingTradeAlerts } = await import("../src/swingBook.js");
  const b = { start: "2026-11-02", returnPct: -2.42, sp: { pct: -0.89 }, open: [{}, {}], orders: [], recent: [{ id: "x", ticker: "DASH", netR: -1.05, reason: "stop" }] };
  const first = bookNews(b, null);
  assert.deepEqual(swingTradeAlerts(first, b), [], "first run is silent");
  const b2 = { ...b, orders: [{ signalDate: "2026-11-10", symbol: "MSFT", ticker: "MSFT", name: "Microsoft", market: "US", currency: "USD", signalPrice: 400, stop: 388, stopPct: -3, why: ["breakout", "MACD cross up"] }], recent: [{ id: "y", ticker: "DE", netR: 1.9, reason: "target" }, ...b.recent] };
  const al = swingTradeAlerts(bookNews(b2, first.seen), b2);
  assert.equal(al.length, 2);
  assert.equal(al[0].kind, "swing");
  assert.equal(al[0].priority, "high");
  assert.equal(al[0].title, "Swing trade (paper): buy MSFT");
  assert.match(al[0].body, /MSFT \(Microsoft, US\): buy at the next open \(last close \$400\.0\)\. Stop \$388\.0 \(3% below\); target about \$424\.0 \(2x the risk\), or out after 20 sessions\. Why: breakout, MACD cross up\./);
  assert.match(al[0].body, /Paper only.*Book -2\.42% since 2 Nov \(S&P -0\.89%\); 2 open\./s);
  assert.equal(al[1].title, "Swing trade (paper): closed DE");
  assert.match(al[1].body, /DE: \+1\.9R after costs \(target hit\)\./);
  const uk = swingTradeAlerts(bookNews({ ...b, orders: [{ signalDate: "2026-11-10", symbol: "HSX.L", ticker: "HSX", market: "UK", currency: "GBp", signalPrice: 1883, stop: 1813.42, stopPct: -3.7 }] }, first.seen), b);
  assert.match(uk[0].body, /last close 1883p\)\. Stop 1813p \(3\.7% below\); target about 2022p/);
  assert.match(uk[0].body, /open before this alert lands/);
  assert.doesNotMatch(al[0].body, /open before this alert lands/);
});
