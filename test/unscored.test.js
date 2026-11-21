import { test } from "node:test";
import assert from "node:assert/strict";
import { unscoredEntry, unscoredLine, MIN_SESSIONS } from "../src/unscored.js";

const bars = (from, n) => {
  const rows = []; let d = new Date(`${from}T12:00:00Z`);
  while (rows.length < n) { const wd = d.getUTCDay(); if (wd && wd !== 6) rows.push({ date: d.toISOString().slice(0, 10), close: 10 }); d = new Date(+d + 864e5); }
  return rows;
};
const u = { symbol: "VYLR", name: "Vylor", index: "SP500" };

test("unscored: a new listing says how many sessions it has and when it scores", () => {
  const rows = bars("2026-11-02", 15); // 2 to 20 Nov
  const e = unscoredEntry(u, { rows });
  assert.equal(e.reason, "new");
  assert.equal(e.sessions, 15);
  assert.equal(e.first, "2026-11-02");
  assert.equal(MIN_SESSIONS, 60);
  // 45 more US sessions after Fri 20 Nov, skipping Thanksgiving, Christmas, New Year's Day and Martin Luther King Day.
  assert.equal(e.scoresFrom, "2027-01-28");
  assert.match(e.text, /^Vylor \(VYLR, S&P 500\): new listing, 15 sessions of prices since Mon 2 Nov; it gets a score from about Thu 28 Jan \(60 needed\)\.$/);
});

test("unscored: London names count London sessions; no prices at all reads as a fetch failure", () => {
  const uk = unscoredEntry({ symbol: "NEW.L", name: "Newco", index: "FTSE100" }, { rows: bars("2026-12-21", 3) }); // 21, 22, 23 Dec
  assert.equal(uk.reason, "new");
  // 57 more London sessions from Wed 23 Dec: Christmas, Boxing Day (Mon 28) and New Year's Day skipped.
  assert.equal(uk.scoresFrom, "2027-03-17");
  const f = unscoredEntry(u, { error: new Error("No chart data for VYLR") });
  assert.equal(f.reason, "fetch");
  assert.equal(f.sessions, 0);
  assert.equal(f.scoresFrom, null);
  assert.equal(f.text, "Vylor (VYLR, S&P 500): no prices from Yahoo tonight (No chart data for VYLR).");
});

test("unscored: a stopped stock and the log line", () => {
  const s = unscoredEntry(u, { rows: bars("2026-01-05", 200), stale: { last: "2026-10-30", behind: 15 } });
  assert.equal(s.reason, "stale");
  assert.equal(s.text, "Vylor (VYLR, S&P 500): last traded Fri 30 Oct (15 sessions behind), so it is left out until it trades again.");
  assert.equal(unscoredLine([]), null);
  const line = unscoredLine([unscoredEntry(u, { rows: bars("2026-11-02", 15) }), s]);
  assert.match(line, /^Not scored \(2\): VYLR new listing, 15 sessions \(scores from 2027-01-28\); VYLR stopped trading 2026-10-30\.$/);
});

test("unscored: MIN_SESSIONS matches what technicals() needs", async () => {
  const { technicals } = await import("../src/research.js");
  const rows = bars("2026-01-05", MIN_SESSIONS).map((r, i) => ({ ...r, close: 10 + (i % 3), high: 13, low: 9, volume: 1000 }));
  assert.equal(technicals(rows.slice(1)), null);
  assert.ok(technicals(rows));
});
