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
