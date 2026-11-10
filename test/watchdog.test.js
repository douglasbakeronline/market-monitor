import test from "node:test";
import assert from "node:assert/strict";
import { pastSlots, chainHealth, watchdogMessage } from "../src/watchdog.js";

const at = (s) => new Date(s);

test("fresh save after the last due slot is ok", () => {
  // Tue 10 Nov 2026: uk-morning 10:15 London (GMT) saved 10:15:23Z; now 11:45Z.
  const h = chainHealth("2026-11-10T10:15:23Z", at("2026-11-10T11:45:00Z"));
  assert.equal(h.ok, true);
  assert.equal(h.lastDue.id, "uk-morning");
});

test("grace period: a slot only just due is not yet missed", () => {
  // uk-midday 12:00Z, now 12:30Z (inside 45 min grace)
  assert.equal(chainHealth("2026-11-10T10:15:23Z", at("2026-11-10T12:30:00Z")).ok, true);
  const h = chainHealth("2026-11-10T10:15:23Z", at("2026-11-10T12:50:00Z"));
  assert.equal(h.ok, false);
  assert.deepEqual(h.missed.map((s) => s.id), ["uk-midday"]);
});

test("weekend: Friday's US close is the last due slot until Sunday's digest", () => {
  // Fri 13 Nov us-close 16:10 New York = 21:10Z
  const sat = chainHealth("2026-11-13T21:10:40Z", at("2026-11-15T09:00:00Z"));
  assert.equal(sat.ok, true);
  assert.equal(sat.lastDue.id, "us-close");
  // Sunday digest 18:00 London = 18:00Z; at 19:00Z it is overdue
  const sun = chainHealth("2026-11-13T21:10:40Z", at("2026-11-15T19:00:00Z"));
  assert.deepEqual(sun.missed.map((s) => s.id), ["weekly-digest"]);
});

test("summer time: uk-open is 07:15Z in June", () => {
  const ids = pastSlots(at("2026-06-10T08:00:00Z")).filter((s) => s.at.toISOString() === "2026-06-10T07:15:00.000Z").map((s) => s.id);
  assert.deepEqual(ids, ["uk-open"]);
});

test("missing or bad timestamp counts as stale", () => {
  const h = chainHealth(null, at("2026-11-10T11:45:00Z"));
  assert.equal(h.ok, false);
  assert.equal(h.missed.length, 1);
});

test("message names missed slots and the action taken", () => {
  const h = chainHealth("2026-11-10T10:15:23Z", at("2026-11-10T21:00:00Z"));
  const m = watchdogMessage(h, { restarted: true });
  assert.match(m.body, /Last saved 10h 45m ago/);
  assert.match(m.body, /missed uk-midday, us-open, us-late-morning and 2 more/);
  assert.match(m.body, /started one/);
  assert.equal(m.priority, "high");
  assert.match(watchdogMessage(h, { active: true }).body, /active but has not saved/);
  assert.match(watchdogMessage(h, {}).body, /by hand/);
});
