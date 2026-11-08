import { test } from "node:test";
import assert from "node:assert/strict";
import { quarterEvents, forward, summarise, dedupe, analyse, barOn, entryIndex } from "../src/smartBacktest.js";

const h = (cusip, ticker, shares, weight) => ({ cusip, ticker, name: ticker, shares, weight, value: weight });

test("quarter events: new, added, held, trimmed, sold at 1%+ only", () => {
  const q1 = { period: "2024-03-31", filed: "2024-05-15", holdings: [h("A", "AAA", 100, 50), h("B", "BRK.B", 100, 30), h("C", "CCC", 100, 19.5), h("D", "DDD", 100, 0.5)] };
  const q2 = { period: "2024-06-30", filed: "2024-08-14", holdings: [h("A", "AAA", 150, 55), h("B", "BRK.B", 50, 20), h("E", "EEE", 10, 20), h("F", "FFF", 10, 0.4)] };
  const ev = quarterEvents("M", [q2, q1]); // any order
  const by = Object.fromEntries(ev.map((e) => [e.ticker, e.change]));
  assert.deepEqual(by, { AAA: "added", "BRK-B": "trimmed", EEE: "new", CCC: "sold" });
  assert.ok(!("FFF" in by), "new position under 1% ignored");
  assert.ok(!("DDD" in by), "sold position that was under 1% ignored");
  assert.equal(ev[0].filed, "2024-08-14");
  assert.equal(quarterEvents("M", [q1]).length, 0, "needs two quarters");
});

const days = (n, start = 0) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1) + (i + start) * 86400000);
  return d.toISOString().slice(0, 10);
});

test("forward returns start the session after filing, against the benchmark", () => {
  const ds = days(200);
  const rows = ds.map((date, i) => ({ date, close: 100 + i })); // rising
  const bench = ds.map((date) => ({ date, close: 100 }));        // flat
  const f = forward({ filed: ds[9] }, rows, bench);
  assert.equal(f.entry, ds[10]);
  assert.deepEqual(f.m3, { ret: 57.3, bench: 0, excess: 57.3 }); // 110 -> 173
  assert.equal(f.m12, null, "not enough bars yet");
  assert.equal(forward({ filed: ds.at(-1) }, rows, bench), null);
  assert.equal(entryIndex(rows, "2023-01-01"), 0);
  assert.equal(barOn(bench, "2023-01-01"), null);
  assert.equal(barOn(bench, ds[5]).date, ds[5]);
});

test("summary, dedupe and groups", () => {
  const e = (ticker, manager, change, excess, period = "2024-06-30") => ({ ticker, manager, change, period, filed: "2024-08-14", fwd: { m3: { ret: excess + 2, bench: 2, excess }, m6: null, m12: { ret: excess, bench: 0, excess } } });
  const evs = [e("A", "X", "new", 10), e("A", "Y", "added", 20), e("B", "X", "added", -4), e("C", "X", "held", 1), { ticker: "D", change: "new", fwd: null }];
  assert.equal(dedupe(evs.slice(0, 3)).length, 2, "same stock, same quarter counts once");
  const s = summarise(evs.slice(0, 3), "m3");
  assert.deepEqual(s, { n: 3, stocks: 2, medianExcess: 10, meanExcess: 8.7, beat: 67, medianRet: 12 });
  assert.deepEqual(summarise([], "m3"), { n: 0 });
  const a = analyse(evs);
  assert.equal(a.groups.buy.m3.n, 2);
  assert.equal(a.groups.held.m3.n, 1);
  assert.equal(a.groups.buy.m6.n, 0);
  assert.equal(a.managers.X.m3.n, 2);
  assert.equal(a.managers.Y.m3.n, 1);
  assert.equal(a.byYear["2024"].n, 2);
});

test("missing quarter is skipped; issuer and Yahoo names compared", async () => {
  const { sameCompany } = await import("../src/smartBacktest.js");
  const q = (period, sh) => ({ period, filed: period, holdings: [h("A", "AAA", sh, 100)] });
  assert.equal(quarterEvents("M", [q("2023-06-30", 100), q("2023-12-31", 200)]).length, 0, "Q3 missing: no diff across six months");
  assert.equal(quarterEvents("M", [q("2023-06-30", 100), q("2023-09-30", 200)])[0].change, "added");
  assert.ok(sameCompany("ALPHABET INC", "Alphabet Inc."));
  assert.ok(sameCompany("BERKSHIRE HATHAWAY INC DEL", "Berkshire Hathaway Inc. New"));
  assert.ok(sameCompany("META PLATFORMS INC", "Meta Platforms, Inc."));
  assert.ok(sameCompany("CCC INTELLIGENT SOLUTIONS H", "CCC Intelligent Solutions Holdings Inc."));
  assert.ok(!sameCompany("CCC INTELLIGENT SOLUTIONS H", "Clarivate Plc"));
  assert.ok(sameCompany("X", null), "no Yahoo name: keep");
  assert.ok(sameCompany("RAYTHEON TECH CORP", "RTX Corporation", "RTX"), "renamed to its ticker");
  assert.ok(sameCompany("General Electric Co.", "GE Aerospace", "GE"));
  assert.ok(!sameCompany("RAYTHEON TECH CORP", "RTX Corporation", "RTN"));
});

test("analyse can use another benchmark", () => {
  const ev = { ticker: "A", manager: "X", change: "new", period: "p", filed: "2024-01-01", fwd: { m3: { ret: 5, bench: 1, excess: 4 } }, fwdEw: { m3: { ret: 5, bench: 6, excess: -1 } } };
  assert.equal(analyse([ev]).groups.buy.m3.medianExcess, 4);
  assert.equal(analyse([ev], "fwdEw").groups.buy.m3.medianExcess, -1);
  assert.equal(analyse([ev]).byYear["2024"].n, 0, "no 12-month result yet");
});
