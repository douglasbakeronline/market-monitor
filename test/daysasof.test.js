import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, earningsAsOf } from "../src/util.js";
import { pickStatus, PLAN } from "../src/plan.js";

test("daysBetween counts whole calendar days", () => {
  assert.equal(daysBetween("2026-11-18", "2026-11-18"), 0);
  assert.equal(daysBetween("2026-11-18", "2026-11-17"), -1);
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2); // across the clock change
});

test("earningsAsOf recounts days from the date, not the research run", () => {
  // Research ran the evening of 17 Nov: NVDA "today" (days 0). Read on 18 Nov it was yesterday.
  assert.deepEqual(earningsAsOf({ date: "2026-11-17", days: 0 }, "2026-11-18"), { date: "2026-11-17", days: -1 });
  assert.deepEqual(earningsAsOf({ date: "2026-11-18", days: 1 }, "2026-11-18"), { date: "2026-11-18", days: 0 });
  assert.equal(earningsAsOf(null, "2026-11-18"), null);
  assert.deepEqual(earningsAsOf({ date: "2026-11-18", days: 1 }, null), { date: "2026-11-18", days: 1 });
});

test("pickStatus counts results days from today, not the research run", () => {
  // META on 18 Nov: research (17 Nov evening) said 71 days to 27 Jan; it is 70.
  const it = { ticker: "META", longTerm: { verdict: "Good entry", score: 77 }, earnings: { date: "2027-01-27", days: 71 } };
  assert.match(pickStatus(PLAN.picks[0], it, "2026-11-18").reason, /Next results in 70 days/);
  // Results tomorrow at the research run are today the next morning: still a wait.
  const soon = { ...it, earnings: { date: "2026-11-18", days: 1 } };
  assert.match(pickStatus(PLAN.picks[0], soon, "2026-11-18").reason, /Results today/);
  // Results the research run called today are out by the next morning.
  const out = { ...it, earnings: { date: "2026-11-17", days: 0 }, lastEarnings: null };
  const p = pickStatus(PLAN.picks[0], out, "2026-11-18");
  assert.equal(p.ok, true);
  assert.equal(p.lastEarnings, "2026-11-17");
});
