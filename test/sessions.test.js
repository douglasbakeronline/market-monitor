import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLIDAYS, isSession, nextSession, orderTiming } from "../src/sessions.js";

test("sessions: weekends and market holidays are skipped, per market", () => {
  assert.equal(isSession("2026-11-14", "US"), false); // Saturday
  assert.equal(isSession("2026-11-26", "US"), false); // Thanksgiving
  assert.equal(isSession("2026-11-26", "UK"), true);
  assert.equal(isSession("2026-12-28", "UK"), false); // Boxing Day substitute
  assert.equal(isSession("2026-12-28", "US"), true);
  assert.equal(nextSession("2026-11-13", "US"), "2026-11-16"); // Fri to Mon
  assert.equal(nextSession("2026-11-25", "US"), "2026-11-27"); // over Thanksgiving
  assert.equal(nextSession("2026-11-25", "UK"), "2026-11-26");
  assert.equal(nextSession("2026-12-24", "UK"), "2026-12-29"); // Christmas, Boxing Day (Mon)
  assert.equal(nextSession("2027-03-25", "UK"), "2027-03-30"); // Good Friday, Easter Monday
  assert.equal(nextSession("2027-03-25", "US"), "2027-03-29");
});

test("sessions: the holiday list reaches at least two months ahead (refresh it each year)", () => {
  const ahead = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  for (const m of ["US", "UK"]) assert.ok(HOLIDAYS[m].until >= ahead, `${m} holidays end ${HOLIDAYS[m].until}`);
});

test("orderTiming: next open, today's open, or already passed (London and New York opens)", () => {
  const at = (iso) => new Date(iso);
  // Signals from Thu 12 Nov's close; Fri 13 Nov's opens are 08:00 London and 14:30 London (09:30 New York).
  assert.deepEqual(orderTiming("2026-11-12", "UK", at("2026-11-12T21:30:00Z")), { due: "2026-11-13", state: "next" });
  assert.deepEqual(orderTiming("2026-11-12", "UK", at("2026-11-13T07:30:00Z")), { due: "2026-11-13", state: "today" });
  assert.deepEqual(orderTiming("2026-11-12", "UK", at("2026-11-13T08:05:00Z")), { due: "2026-11-13", state: "passed" });
  assert.deepEqual(orderTiming("2026-11-12", "US", at("2026-11-13T12:00:00Z")), { due: "2026-11-13", state: "today" });
  assert.deepEqual(orderTiming("2026-11-12", "US", at("2026-11-13T19:30:00Z")), { due: "2026-11-13", state: "passed" });
  assert.equal(orderTiming("2026-11-12", "US", at("2026-11-16T10:00:00Z")).state, "passed");
  // Summer: London 08:00 BST is 07:00 UTC.
  assert.equal(orderTiming("2027-06-10", "UK", at("2027-06-11T07:05:00Z")).state, "passed");
  assert.equal(orderTiming("2027-06-10", "UK", at("2027-06-11T06:55:00Z")).state, "today");
  // Friday's signal: Monday's open, shown as next over the weekend.
  assert.deepEqual(orderTiming("2026-11-13", "US", at("2026-11-14T10:00:00Z")), { due: "2026-11-16", state: "next" });
  assert.equal(orderTiming(null, "US", at("2026-11-14T10:00:00Z")), null);
});

test("openPhrase: the open in words, in London time, for the pot's pushes", async () => {
  const { openPhrase, openInLondon } = await import("../src/sessions.js");
  const at = (iso) => new Date(iso);
  assert.equal(openInLondon("2026-11-13", "US"), "14:30");
  assert.equal(openInLondon("2026-11-13", "UK"), "08:00");
  assert.equal(openInLondon("2027-03-15", "US"), "13:30"); // New York on summer time, London not yet
  assert.equal(openInLondon("2027-06-11", "UK"), "08:00");
  // Evening push on Thu 12 Nov: tomorrow's open.
  assert.deepEqual(openPhrase("2026-11-12", "UK", at("2026-11-12T21:30:00Z")), { state: "next", due: "2026-11-13", text: "the next open" });
  // Evening push on Fri 13 Nov: Monday's.
  assert.equal(openPhrase("2026-11-13", "US", at("2026-11-13T21:20:00Z")).text, "the Mon 16 Nov open");
  // 08:15 fallback on Fri 13 Nov: London's open has passed, New York's is ahead.
  assert.deepEqual(openPhrase("2026-11-12", "UK", at("2026-11-13T08:15:00Z")), { state: "passed", due: "2026-11-13", text: "today's 08:00 open" });
  assert.deepEqual(openPhrase("2026-11-12", "US", at("2026-11-13T08:15:00Z")), { state: "today", due: "2026-11-13", text: "today's open (14:30 London)" });
  assert.equal(openPhrase("2026-11-12", "UK", at("2026-11-13T07:30:00Z")).text, "today's open (08:00 London)");
  assert.equal(openPhrase("2026-11-12", "US", null).text, "the next open");
});
