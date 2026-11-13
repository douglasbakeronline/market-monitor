import { test } from "node:test";
import assert from "node:assert/strict";
import { todayItems } from "../src/today.js";

test("today: pot orders first, then plan actions due within a day, results tomorrow, decisions", () => {
  const d = {
    shortTerm: { pot: { sells: [{ ticker: "OTIS" }], buys: [{ ticker: "BRBY", kind: "drift" }] } },
    copilot: { actions: [{ title: "Second core purchase", inDays: 1, status: "due" }, { title: "Later", inDays: 4, status: "due" }, { title: "Done", inDays: 0, status: "done" }] },
    resultsPreview: { focus: [{ ticker: "NVDA", date: "2026-11-17", typical: 4.4 }, { ticker: "HSBA", date: "2026-11-13", typical: 4.2 }, { ticker: "CF", date: "2026-11-16", typical: null, held: true }] },
  };
  const t = todayItems(d, "2026-11-12", { decisions: 3 });
  assert.deepEqual(t.map((x) => x.text), [
    "Sell OTIS at the next open (short-term pot, exit rule met)",
    "Buy BRBY at the next open (short-term pot, results drift)",
    "Tomorrow: Second core purchase",
    "HSBA reports tomorrow; it usually moves ±4.2%",
    "CF reports in 4 days (the pot holds it)",
    "3 decisions waiting on you",
  ]);
  assert.deepEqual(todayItems({}, "2026-11-12"), []);
  assert.equal(todayItems({ shortTerm: { pot: { paused: true } } }, "2026-11-12")[0].tone, "sell");
});

test("today: pot orders whose open has passed become one reminder to log them (13 Nov)", () => {
  const d = {
    shortTerm: { date: "2026-11-12", pot: { rules: { today: "2026-11-12" }, sells: [{ ticker: "OTIS", market: "US", exitDate: "2026-11-12" }],
      buys: [{ ticker: "BRBY", kind: "drift", market: "UK", signalDate: "2026-11-12" }, { ticker: "ABT", kind: "bounce", market: "US", signalDate: "2026-11-12" }] } },
  };
  const texts = (iso, today) => todayItems(d, today, { now: new Date(iso) }).map((x) => x.text);
  // Evening before: both ahead.
  assert.deepEqual(texts("2026-11-12T21:40:00Z", "2026-11-12"), [
    "Sell OTIS at the next open (short-term pot, exit rule met)",
    "Buy BRBY at the next open (short-term pot, results drift)",
    "Buy ABT at the next open (short-term pot, bounce)",
  ]);
  // 07:30 London: both today.
  assert.equal(texts("2026-11-13T07:30:00Z", "2026-11-13")[1], "Buy BRBY at today's open (short-term pot, results drift)");
  // 10:00 London: London has opened, New York has not.
  assert.deepEqual(texts("2026-11-13T10:00:00Z", "2026-11-13"), [
    "Sell OTIS at today's open (short-term pot, exit rule met)",
    "Buy ABT at today's open (short-term pot, bounce)",
    "Short-term pot orders were due at today's open: BRBY. Log them if you placed them; the next list follows the evening scan.",
  ]);
  // 19:30 London: all passed, one line linked to the trade log.
  const late = todayItems(d, "2026-11-13", { now: new Date("2026-11-13T19:30:00Z") });
  assert.equal(late.length, 1);
  assert.equal(late[0].text, "Short-term pot orders were due at today's open: sell OTIS, BRBY, ABT. Log them if you placed them; the next list follows the evening scan.");
  assert.equal(late[0].href, "#tlSection");
  // A scan that failed: still listed, with the day.
  assert.match(todayItems(d, "2026-11-16", { now: new Date("2026-11-16T19:30:00Z") })[0].text, /due at the Fri 13 Nov open/);
  // Friday's orders over the weekend name Monday.
  const fri = { shortTerm: { date: "2026-11-13", pot: { buys: [{ ticker: "ABT", kind: "bounce", market: "US", signalDate: "2026-11-13" }] } } };
  assert.equal(todayItems(fri, "2026-11-14", { now: new Date("2026-11-14T10:00:00Z") })[0].text, "Buy ABT at the Mon 16 Nov open (short-term pot, bounce)");
});
