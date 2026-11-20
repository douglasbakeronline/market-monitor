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
    "Short-term pot orders were due at today's open: buy BRBY. Log them if you placed them; the next list follows the evening scan.",
  ]);
  // 19:30 London: all passed, one line linked to the trade log.
  const late = todayItems(d, "2026-11-13", { now: new Date("2026-11-13T19:30:00Z") });
  assert.equal(late.length, 1);
  assert.equal(late[0].text, "Short-term pot orders were due at today's open: sell OTIS; buy BRBY, ABT. Log them if you placed them; the next list follows the evening scan.");
  assert.equal(late[0].href, "#tlSection");
  // A scan that failed: still listed, with the day.
  assert.match(todayItems(d, "2026-11-16", { now: new Date("2026-11-16T19:30:00Z") })[0].text, /due at the Fri 13 Nov open/);
  // Friday's orders over the weekend name Monday.
  const fri = { shortTerm: { date: "2026-11-13", pot: { buys: [{ ticker: "ABT", kind: "bounce", market: "US", signalDate: "2026-11-13" }] } } };
  assert.equal(todayItems(fri, "2026-11-14", { now: new Date("2026-11-14T10:00:00Z") })[0].text, "Buy ABT at the Mon 16 Nov open (short-term pot, bounce)");
});

test("today: passed orders keep buy and sell apart (17 Nov: 'sell OTIS, ILMN' read as two sells)", () => {
  const d = { shortTerm: { date: "2026-11-16", pot: { rules: { today: "2026-11-16" },
    sells: [{ ticker: "OTIS", market: "US", exitDate: "2026-11-16" }], buys: [{ ticker: "ILMN", kind: "bounce", market: "US", signalDate: "2026-11-16" }] } } };
  const t = todayItems(d, "2026-11-17", { now: new Date("2026-11-17T21:00:00Z") });
  assert.equal(t[0].text, "Short-term pot orders were due at today's open: sell OTIS; buy ILMN. Log them if you placed them; the next list follows the evening scan.");
  const sellsOnly = { shortTerm: { date: "2026-11-16", pot: { rules: { today: "2026-11-16" }, buys: [],
    sells: [{ ticker: "OTIS", market: "US", exitDate: "2026-11-16" }, { ticker: "ABT", market: "US", exitDate: "2026-11-16" }] } } };
  assert.match(todayItems(sellsOnly, "2026-11-17", { now: new Date("2026-11-17T21:00:00Z") })[0].text, /open: sell OTIS, ABT\./);
});

test("today: a caught-up sell (15 Nov) is due at the next open, not its own exit's open, and says so", () => {
  const d = { shortTerm: { date: "2026-11-18", pot: { rules: { today: "2026-11-18", since: "2026-11-16" }, buys: [],
    sells: [{ ticker: "TUE", market: "US", exitDate: "2026-11-17", orderDate: "2026-11-18", late: true }, { ticker: "WED", market: "US", exitDate: "2026-11-18", orderDate: "2026-11-18" }] } } };
  assert.deepEqual(todayItems(d, "2026-11-18", { now: new Date("2026-11-18T21:40:00Z") }).map((x) => x.text), [
    "Sell TUE at the next open (short-term pot, exit rule met on Tue 17 Nov, missed by an earlier list)",
    "Sell WED at the next open (short-term pot, exit rule met)",
  ]);
});

test("today: a confirmed buy tier stays on the Today card for its week, dated (20 Nov)", () => {
  const a = { kind: "tier", date: "2026-11-20", title: "Buy tier confirmed: S&P 500 Correction (−10%)", status: "go" };
  assert.deepEqual(todayItems({ copilot: { actions: [{ ...a, inDays: 0 }] } }, "2026-11-20").map((x) => x.text),
    ["Buy tier confirmed today: S&P 500 Correction (−10%). Plan: a third of the dip reserve into VWRP; log it once placed"]);
  assert.deepEqual(todayItems({ copilot: { actions: [{ ...a, inDays: -3 }] } }, "2026-11-23").map((x) => x.text),
    ["Buy tier confirmed Fri 20 Nov: S&P 500 Correction (−10%). Plan: a third of the dip reserve into VWRP; log it once placed"]);
});
