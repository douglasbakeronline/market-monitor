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

test("shortPot: skip list (13 Nov) blocks new buys from its date, keeps earlier trades and frees the slot", () => {
  const log = [
    tr({ kind: "drift", symbol: "BRBY.L", ticker: "BRBY", market: "UK", signalDate: "2026-11-11", status: "open", entryDate: "2026-11-12", entry: 10, netPct: 1 }),
    tr({ kind: "drift", symbol: "BRBY.L", ticker: "BRBY", market: "UK", signalDate: "2026-11-16", status: "pending", results: true, volX: 9 }),
    tr({ kind: "bounce", symbol: "Q", signalDate: "2026-11-16", status: "pending", rsi2: 4 }),
  ];
  const none = shortPot(log, { today: "2026-11-16" });
  assert.deepEqual(none.buys.map((x) => x.symbol), ["BRBY.L", "Q"], "an empty list changes nothing");
  assert.deepEqual(none.skipList, []);
  const p = shortPot(log, { today: "2026-11-16", skip: [{ symbol: "BRBY.L", from: "2026-11-14" }] });
  assert.deepEqual(p.open.map((x) => x.symbol), ["BRBY.L"], "a trade taken before the date stays");
  assert.deepEqual(p.buys.map((x) => x.symbol), ["Q"], "the skipped name frees its slot");
  assert.equal(p.skipped, 0, "skip-list names are not counted as missing a slot");
  assert.deepEqual(p.skipList.map((x) => x.symbol), ["BRBY.L"]);
  // A replayed entry after the date is never held either.
  const q = shortPot([tr({ kind: "drift", symbol: "X.L", signalDate: "2026-11-16", status: "open", entryDate: "2026-11-17", entry: 10, netPct: 3 })], { skip: [{ symbol: "X.L" }] });
  assert.equal(q.open.length, 0, "no date means from the start");
});

test("potSkips: reads the skip file safely", async () => {
  const { potSkips } = await import("../src/shortPot.js");
  assert.deepEqual(potSkips(null), []);
  assert.deepEqual(potSkips({ skip: [{ symbol: "brby.l", from: "2026-11-14" }, { from: "x" }, "BAD"] }), [{ symbol: "BRBY.L", from: "2026-11-14" }]);
});

test("shortPot: exits since the last listed close stay on the sell list (a skipped night's sells are not lost)", () => {
  const log = [
    tr({ kind: "bounce", symbol: "TUE", signalDate: "2026-11-12", status: "closed", entryDate: "2026-11-13", entry: 10, exitDate: "2026-11-17", exit: 10.3, netPct: 2.7 }),
    tr({ kind: "bounce", symbol: "WED", signalDate: "2026-11-12", status: "closed", entryDate: "2026-11-13", entry: 10, exitDate: "2026-11-18", exit: 10.1, netPct: 0.7 }),
    tr({ kind: "bounce", symbol: "MON", signalDate: "2026-11-12", status: "closed", entryDate: "2026-11-13", entry: 10, exitDate: "2026-11-16", exit: 10.2, netPct: 1.7 }),
  ];
  // Monday's list went out; Tuesday's scan was skipped; Wednesday's runs.
  const p = shortPot(log, { today: "2026-11-18", since: "2026-11-16" });
  assert.deepEqual(p.sells.map((x) => x.ticker), ["TUE", "WED"], "Monday's sell was listed on Monday; Tuesday's is caught up");
  assert.deepEqual(p.sells.map((x) => x.late ?? false), [true, false]);
  assert.ok(p.sells.every((x) => x.orderDate === "2026-11-18"), "every sell is due at the open after the latest close");
  assert.equal(p.rules.since, "2026-11-16");
  assert.deepEqual(p.sells.map((x) => x.symbol), ["TUE", "WED"], "sells carry the symbol, so the push's dedup key tells them apart");
  const q = shortPot(log, { today: "2026-11-18" });
  assert.deepEqual(q.sells.map((x) => x.ticker), ["WED"], "without a previous list date, only the latest close");
});

test("potSince: the previous list's close, kept through a rerun of the same night", async () => {
  const { potSince } = await import("../src/shortPot.js");
  assert.equal(potSince(null, "2026-11-18"), null);
  assert.equal(potSince({ rules: { today: "2026-11-16" } }, "2026-11-18"), "2026-11-16");
  assert.equal(potSince({ rules: { today: "2026-11-18", since: "2026-11-16" } }, "2026-11-18"), "2026-11-16", "a rerun keeps the earlier anchor");
  assert.equal(potSince({ rules: { today: "2026-11-18" } }, "2026-11-18"), null);
  assert.equal(potSince({ rules: { today: "2026-11-18", since: "2026-11-16" } }, "2026-11-17"), null, "a date that went backwards lists the latest close only");
  assert.equal(potSince({ rules: { today: "2026-11-02" } }, "2026-11-18"), "2026-11-02", "no cap: a sell missed for weeks is still held");
});

test("potUnlisted + shortPot: a skipped night's signals were never listed, so the pot never takes them (15 Nov)", async () => {
  const { potUnlisted } = await import("../src/shortPot.js");
  const log = [
    tr({ kind: "bounce", symbol: "MON", signalDate: "2026-11-16", status: "open", entryDate: "2026-11-17", entry: 10, netPct: 1 }),
    tr({ kind: "bounce", symbol: "TUE", signalDate: "2026-11-17", status: "open", entryDate: "2026-11-18", entry: 10, netPct: 2 }),
    tr({ kind: "drift", symbol: "TUE2", signalDate: "2026-11-17", status: "closed", entryDate: "2026-11-18", entry: 10, exitDate: "2026-11-18", exit: 9, netPct: -10 }),
    tr({ kind: "bounce", symbol: "WED", signalDate: "2026-11-18", status: "pending", rsi2: 3 }),
  ];
  // Monday's list went out (today 16th); Tuesday's scan was skipped; Wednesday's runs.
  const prev = { rules: { today: "2026-11-16" }, unlisted: ["2026-11-01:drift:OLD"] };
  const ids = potUnlisted(prev, log, "2026-11-18");
  assert.deepEqual(ids, ["2026-11-01:drift:OLD", "2026-11-17:bounce:TUE", "2026-11-17:drift:TUE2"], "kept and added, sorted");
  const p = shortPot(log, { today: "2026-11-18", since: "2026-11-16", unlisted: ids });
  assert.deepEqual(p.open.map((x) => x.symbol), ["MON"], "the listed buy is held; the unlisted ones are not");
  assert.deepEqual(p.sells, [], "no sell for a trade never bought");
  assert.deepEqual(p.buys.map((x) => x.symbol), ["WED"]);
  assert.deepEqual(p.unlisted, ids, "carried in the file so the next night keeps them out");
  assert.deepEqual(potUnlisted(null, log, "2026-11-18"), [], "first run: nothing");
  assert.deepEqual(potUnlisted({ rules: { today: "2026-11-18" }, unlisted: ids }, log, "2026-11-18"), ids, "rerun: unchanged");
  assert.deepEqual(potUnlisted({ rules: { today: "2026-11-19" }, unlisted: [] }, log, "2026-11-18"), [], "a date that went backwards adds nothing");
});

test("shortPot: a trade that exits at a close frees its slot for the next open, not that day's open (16 Nov)", () => {
  // 16 Nov: OTIS's exit came at the 16 Nov close, so its slot was still held
  // at the 16 Nov open. The book used to free it first and enter PSA (a 13 Nov
  // signal, never listed as a buy: all five slots were held on 13 Nov), then
  // told Douglas the pot was full when he really held four.
  const held = ["ABT", "AMCR", "IFF", "BRBY"].map((s) => tr({ kind: "bounce", symbol: s, signalDate: "2026-11-12", status: "open", entryDate: "2026-11-13", entry: 10, netPct: -1, sessions: 2 }));
  const log = [
    tr({ kind: "bounce", symbol: "OTIS", signalDate: "2026-11-11", status: "closed", entryDate: "2026-11-12", entry: 10, exitDate: "2026-11-16", exit: 9.9, netPct: -0.89 }),
    ...held,
    tr({ kind: "bounce", symbol: "PSA", signalDate: "2026-11-13", status: "open", entryDate: "2026-11-16", entry: 10, netPct: -0.3, sessions: 1, rsi2: 2 }),
    tr({ kind: "bounce", symbol: "ILMN", signalDate: "2026-11-16", status: "pending", rsi2: 2.8 }),
    tr({ kind: "bounce", symbol: "VEEV", signalDate: "2026-11-16", status: "pending", rsi2: 3.1 }),
  ];
  const p = shortPot(log, { today: "2026-11-16", since: "2026-11-13" });
  assert.deepEqual(p.open.map((x) => x.symbol).sort(), ["ABT", "AMCR", "BRBY", "IFF"], "PSA never had a slot");
  assert.deepEqual(p.sells.map((x) => x.symbol), ["OTIS"]);
  assert.equal(p.free, 1);
  assert.deepEqual(p.buys.map((x) => x.symbol), ["ILMN"], "OTIS's slot goes to the most oversold of tonight's signals");
  assert.equal(p.closed, 1);
  // Same-day round trip (entry at an open, exit at that close) still closes.
  const q = shortPot([tr({ kind: "bounce", symbol: "S", signalDate: "2026-11-12", status: "closed", entryDate: "2026-11-13", entry: 10, exitDate: "2026-11-13", exit: 10.2, netPct: 1.5 })], { today: "2026-11-13" });
  assert.equal(q.closed, 1);
  assert.deepEqual(q.sells.map((x) => x.symbol), ["S"]);
  assert.equal(q.open.length, 0);
});
