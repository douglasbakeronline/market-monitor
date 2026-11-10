import { test } from "node:test";
import assert from "node:assert/strict";
import { allowAlert, summaryAllowed, PROFILES } from "../src/alertProfile.js";
import { CONFIG } from "../src/config.js";

test("plan-swing keeps plan and swing alerts, mutes the rest", () => {
  const keep = ["health", "buy", "crash", "pullback", "price", "research-pick", "swing"];
  const mute = ["watch", "greed", "trim", "fear-no-dip", "research", "book"];
  for (const k of keep) assert.equal(allowAlert({ kind: k }, "plan-swing"), true, k);
  for (const k of mute) assert.equal(allowAlert({ kind: k }, "plan-swing"), false, k);
  for (const k of [...keep, ...mute]) assert.equal(allowAlert({ kind: k }, "all"), true);
  assert.equal(allowAlert({ kind: "greed" }, "no-such-profile"), true, "unknown profile sends everything");
});

test("summaries: full, plan lines only, or none", () => {
  assert.equal(summaryAllowed("all", []), "full");
  assert.equal(summaryAllowed("plan-swing", ["Mon 16 Nov: core purchase"]), "plan");
  assert.equal(summaryAllowed("plan-swing", []), "none");
});

test("the live profile is one that exists", () => {
  assert.ok(CONFIG.alertProfile in PROFILES);
});
