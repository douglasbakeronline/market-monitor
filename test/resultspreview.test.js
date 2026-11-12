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

test("usual move: real dates only, the bigger move of that day and the next, after-close names the next day", () => {
  const rows = bars(240, { 66: 1, 67: -8, 130: 3, 196: -5, 197: 1 }, { 150: 9 });
  // 66 then 67: the bigger move (67) is the reaction; 130 on the day; the
  // volume spike at 150 has no date and is ignored.
  const m = typicalMove(rows, [rows[66].date, rows[130].date, "2027-01-01"]);
  assert.deepEqual(m.moves.map((x) => x.pct), [-8, 3]);
  assert.equal(m.typical, 5.5);
  // Known after-close reporter: always the next session.
  assert.deepEqual(typicalMove(rows, [rows[196].date], true).moves.map((x) => x.pct), [1]);
  assert.equal(typicalMove(rows, []), null);
});

test("preview: list names in the next 7 days, plus pot-universe names, biggest usual movers first", () => {
  const rows = bars(240, { 100: -6, 160: 7, 120: 2 });
  const items = [
    { symbol: "BRBY.L", ticker: "BRBY", name: "Burberry", index: "FTSE 100", market: "UK", earnings: { date: "2026-11-13" } },
    { symbol: "MSFT", ticker: "MSFT", name: "Microsoft", index: "S&P 500", market: "US", earnings: { date: "2026-11-30" } },
    { symbol: "NVDA", ticker: "NVDA", name: "Nvidia", index: "S&P 500", market: "US", earnings: { date: "2026-11-17" } },
    { symbol: "CSCO", ticker: "CSCO", name: "Cisco", index: "S&P 500", market: "US", earnings: { date: "2026-11-12" } },
    { symbol: "KO", ticker: "KO", name: "Coca-Cola", index: "S&P 500", market: "US", earnings: { date: "2026-11-16" } },
    { symbol: "X.L", ticker: "X", name: "Est", index: "FTSE 100", market: "UK", resultsEstimate: { date: "2026-11-14", stale: false } },
    { symbol: "Y", ticker: "Y", name: "Old", index: "S&P 500", market: "US", earnings: { date: "2026-11-10" } },
  ];
  const by = Object.fromEntries(items.map((i) => [i.symbol, rows]));
  const dates = { BRBY: [], "BRBY.L": [rows[100].date, rows[160].date, "2026-11-13"], CSCO: [rows[120].date], KO: [rows[160].date] };
  const p = resultsPreview(items, { today: "2026-11-12", focus: new Set(["BRBY.L", "MSFT", "NVDA"]), rowsBySymbol: by, dates });
  assert.deepEqual(p.focus.map((r) => r.ticker), ["BRBY", "NVDA"]); // MSFT too far, sorted by date
  assert.equal(p.focus[0].typical, 6.5);
  assert.equal(p.focus[0].days, 1);
  assert.equal(p.focus[0].pot, true);
  assert.equal(p.focus[1].typical, null);
  assert.deepEqual(p.watch.map((r) => r.ticker), ["KO", "CSCO"]); // biggest first; estimated and past dates left out
  assert.equal(p.potCount, 2);
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
  // Results day itself is never pushed.
  assert.equal(resultsAlert({ days: 7, focus: [{ symbol: "B", ticker: "B", date: "2026-11-12", typical: null, moves: [] }] }, {}, "2026-11-12").alert, null);
  // Past keys are dropped.
  assert.deepEqual(Object.keys(resultsAlert(preview, eve.sent, "2026-11-19").sent), []);
});

test("labels and lines read plainly", () => {
  assert.equal(dayLabel("2026-11-12", "2026-11-12"), "today");
  assert.equal(dayLabel("2026-11-20", "2026-11-12"), "Fri 20 Nov");
  const l = previewLine({ ticker: "BRBY", date: "2026-11-13", typical: 6.1, moves: [{ pct: 5.2 }, { pct: -7 }], last: { surprisePct: 3.9, reaction: -5.4 } }, "2026-11-12");
  assert.equal(l, "BRBY tomorrow: usually moves ±6.1% on results (last 2: +5.2%, −7.0%); last time EPS +3.9% vs forecast, −5.4% on the day.");
});

test("timed dates: after the close reacts the next session, before the close that session", async () => {
  const { reportedSessions } = await import("../src/data/fundamentals.js");
  // NVDA 19 Nov 2025 21:20 UTC (16:20 New York): after the close. HSBC
  // 27 Oct 2026 04:40 UTC: before the London open. A bare midnight stamp: unknown.
  assert.deepEqual(reportedSessions([1763587200e3], "NVDA"), [{ date: "2025-11-19", after: true }]);
  assert.deepEqual(reportedSessions([1793073612e3, Date.parse("2026-01-01T00:00:00Z")], "HSBA.L"), [{ date: "2026-01-01", after: null }, { date: "2026-10-27", after: false }]);
  const rows = bars(240, { 66: 9, 67: -3, 130: 2, 131: -11 });
  // after: false takes the day itself even when the next move is bigger.
  const m = typicalMove(rows, [{ date: rows[66].date, after: true }, { date: rows[130].date, after: false }]);
  assert.deepEqual(m.moves.map((x) => x.pct), [-3, 2]);
  // Timed dates replace the same plain date in the preview.
  const items = [{ symbol: "Z", ticker: "Z", name: "Z", index: "S&P 500", market: "US", earnings: { date: "2026-11-13" } }];
  const p = resultsPreview(items, { today: "2026-11-12", rowsBySymbol: { Z: rows }, reported: { Z: [{ date: rows[66].date, after: true }] }, dates: { Z: [rows[66].date] } });
  assert.deepEqual(p.watch[0].moves.map((x) => x.pct), [-3]);
});

test("beat record, pot holdings and just reported", async () => {
  const { beatRecord, justReported, recentCandidates } = await import("../src/resultsPreview.js");
  const hist = [1, 2, -3, 4, 5, 0, 6, 7, 8].map((v, k) => ({ date: `2026-0${(k % 9) + 1}-10`, after: false, surprisePct: v }));
  const r = beatRecord(hist, "2026-11-12");
  assert.deepEqual([r.n, r.beats, r.median], [8, 6, 4.5]);
  // Held names join the list even when not on the research list.
  const rows = bars(240, { 239: 6 }, { 239: 4 });
  const items = [{ symbol: "Q", ticker: "Q", name: "Q", index: "S&P 500", market: "US", earnings: { date: "2026-11-16" } }];
  const p = resultsPreview(items, { today: "2026-11-12", held: new Set(["Q"]), rowsBySymbol: { Q: rows }, reported: { Q: hist } });
  assert.equal(p.focus[0].held, true);
  assert.match(previewLine(p.focus[0], "2026-11-12"), /beat the forecast 6 of the last 8 times\. The short-term pot holds it/);
  // Just reported: the latest bar is the reaction day.
  const j = justReported(items, { rowsBySymbol: { Q: rows }, reported: { Q: [{ date: rows[238].date, after: true, surprisePct: 9 }] } });
  assert.deepEqual([j[0].move, j[0].volX, j[0].surprisePct, j[0].potBuy], [6, 4, 9, true]);
  assert.equal(justReported(items, { rowsBySymbol: { Q: rows }, reported: { Q: [{ date: rows[238].date, after: false }] } }).length, 0);
  assert.equal(recentCandidates(items, { today: "2026-11-12", dates: { Q: ["2026-11-10"] } }).length, 1);
  assert.equal(recentCandidates(items, { today: "2026-11-12", dates: { Q: ["2026-11-01"] } }).length, 0);
});

test("London results always read as that session (Yahoo's 16:30 placeholder)", async () => {
  const { reportedSessions } = await import("../src/data/fundamentals.js");
  assert.deepEqual(reportedSessions([1794501000e3], "BRBY.L"), [{ date: "2026-11-12", after: false }]);
});
