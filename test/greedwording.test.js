// Greed and the trim signal are context and a rebalance reminder only
// (decided 12 Nov 2026, STRATEGY-NOTES "Rebalancing"): no wording may tell
// Douglas to hold cash back or trim winners outside the rebalance rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { regime } from "../src/signals.js";
import { regimeNote } from "../src/research.js";

const sp = { drawdownPct: -1, vs200Pct: 12, above200: true, peak: 7000 };

test("overheated regime reads as a rebalance reminder, not a trim of winners", () => {
  const r = regime({ sp, vix: { level: 12 }, fg: { score: 85 } });
  assert.equal(r.key, "overheated");
  assert.doesNotMatch(r.action, /trimming winners/i);
  assert.match(r.action, /5 or more points off/);
  assert.match(r.action, /not a sell/i);
});

test("frothy markets do not tell a Good entry to keep cash back", () => {
  for (const k of ["euphoric", "overheated"]) {
    const n = regimeNote(k, "Good entry");
    assert.ok(n);
    assert.doesNotMatch(n, /keep cash|starter position/i);
    assert.match(n, /tranche rule applies as usual/);
  }
  assert.match(regimeNote("correction", "Good entry"), /fear is on your side/);
  assert.equal(regimeNote("healthy", "Good entry"), null);
});
