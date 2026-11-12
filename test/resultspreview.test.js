import { test } from "node:test";
import assert from "node:assert/strict";
import { typicalMove, resultsPreview, resultsAlert, dayLabel, previewLine } from "../src/resultsPreview.js";

// Weekday bars from 2025-11-03 with given close changes and volume spikes.
const bars = (n, jumps = {}, spikes = {}) => {
  const out = [];
  let p = 100;
  for (let t = Date.UTC(2025, 10, 3); out.length < n; t += 864e5) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const i = out.length;
    const prev = p;
    p = jumps[i] != null ? p * (1 + jumps[i] / 100) : p;
    out.push({ date: new Date(t).toISOString().slice(0, 10), open: prev, high: p, low: p, close: p, volume: 1e6 * (spikes[i] ?? 1) });
  }
  return out;
};

test("usual move: known dates first (busier of that day and the next), else volume-found days", () => {
  // Known 2026-02-05 (index 66, after-close: busier next day 67); volume-found
  // spikes in May and Aug; the Feb volume spike at 67 is not counted twice.
  const rows = bars(240, { 67: -8, 130: 3, 196: -5 }, { 67: 5, 130: 4, 196: 6 });
  const m = typicalMove(rows, [rows[66].date]);
  assert.equal(m.n, 3);
  assert.deepEqual(m.moves.map((x) => x.pct), [-8, 3, -5]);
  assert.equal(m.typical, 5);
});

test("preview: list names in the next 7 days, plus pot-universe names, biggest usual movers first", () => {
  const items = [
    { symbol: "BRBY.L", ticker: "BRBY", name: "Burberry", index: "FTSE 100", market: "UK", earnings: { date: "2026-11-13" }, resultsCheck: { moves: { typical: 6.1, moves: [{ pct: 5 }, { pct: -7 }] } } },
    { symbol: "MSFT", ticker: "MSFT", name: "Microsoft", index: "S&P 500", market: "US", earnings: { date: "2026-11-30" } },
    { symbol: "NVDA", ticker: "NVDA", name: "Nvidia", index: "S&P 500", market: "US", earnings: { date: "2026-11-17" }, resultsCheck: { moves: { typical: 4, moves: [] } } },
    { symbol: "CSCO", ticker: "CSCO", name: "Cisco", index: "S&P 500", market: "US", earnings: { date: "2026-11-12" }, resultsCheck: { moves: { typical: 7, moves: [] } } },
    { symbol: "X.L", ticker: "X", name: "Est", index: "FTSE 100", market: "UK", resultsEstimate: { date: "2026-11-14", stale: false } },
    { symbol: "Y", ticker: "Y", name: "Old", index: "S&P 500", market: "US", earnings: { date: "2026-11-10" } },
  ];
  const p = resultsPreview(items, { today: "2026-11-12", focus: new Set(["BRBY.L", "MSFT", "NVDA"]) });
  assert.deepEqual(p.focus.map((r) => r.ticker), ["BRBY", "NVDA"]); // MSFT too far, sorted by date
  assert.deepEqual(p.watch.map((r) => r.ticker), ["CSCO"]); // estimated and past dates left out
  assert.equal(p.focus[0].days, 1);
  assert.equal(p.focus[0].pot, true);
});

test("alert: once when a name enters the week, again the day before, never twice", () => {
  const preview = { days: 7, focus: [
    { symbol: "HSBA.L", ticker: "HSBA", date: "2026-11-17", typical: 4.2, moves: [{ pct: -6 }, { pct: 2 }], pot: true },
    { symbol: "SPCX", ticker: "SPCX", date: "2026-11-18", typical: null, moves: [], pot: false },
  ] };
  const a = resultsAlert(preview, {}, "2026-11-12");
  assert.match(a.alert.title, /^Results ahead: HSBA Tue 17 Nov, SPCX Wed 18 Nov$/);
  assert.match(a.alert.body, /HSBA: a close up 4%\+/);
  assert.doesNotMatch(a.alert.body, /SPCX: a close/);
  assert.equal(resultsAlert(preview, a.sent, "2026-11-13").alert, null);
  const eve = resultsAlert(preview, a.sent, "2026-11-16");
  assert.match(eve.alert.title, /^Results ahead: HSBA tomorrow$/);
  assert.match(eve.alert.body, /Also this week: SPCX Wed 18 Nov/);
  assert.equal(resultsAlert(preview, eve.sent, "2026-11-16").alert, null);
  // Past keys are dropped.
  assert.deepEqual(Object.keys(resultsAlert(preview, eve.sent, "2026-11-19").sent), []);
});

test("labels and lines read plainly", () => {
  assert.equal(dayLabel("2026-11-12", "2026-11-12"), "today");
  assert.equal(dayLabel("2026-11-20", "2026-11-12"), "Fri 20 Nov");
  const l = previewLine({ ticker: "BRBY", date: "2026-11-13", typical: 6.1, moves: [{ pct: 5.2 }, { pct: -7 }], last: { surprisePct: 3.9, reaction: -5.4 } }, "2026-11-12");
  assert.equal(l, "BRBY tomorrow: usually moves ±6.1% on results (last 2: +5.2%, −7.0%); last time EPS +3.9% vs forecast, −5.4% on the day.");
});
