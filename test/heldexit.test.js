import { test } from "node:test";
import assert from "node:assert/strict";
import { exitBy, heldLine } from "../src/shortTerm.js";

// 19 Nov: the pot card said "Held: BRBY −1.6% (4 sessions)" with no word on
// when each trade sells, though the pot is real money.
test("exitBy: drift sells at the open after its 20th session's close", () => {
  // Burberry, bought at the 13 Nov London open: 20th session closes Thu 10 Dec.
  assert.deepEqual(exitBy({ kind: "drift", market: "UK", entryDate: "2026-11-13" }), { lastClose: "2026-12-10", sellOpen: "2026-12-11", early: false });
});

test("exitBy: a bounce sells by the open after its 10th session at the latest, skipping holidays", () => {
  // Abbott, bought at the 13 Nov New York open; Thanksgiving (26 Nov) is closed,
  // so the 10th session is Fri 27 Nov and the latest sell is Mon 30 Nov.
  assert.deepEqual(exitBy({ kind: "bounce", market: "US", entryDate: "2026-11-13" }), { lastClose: "2026-11-27", sellOpen: "2026-11-30", early: true });
  // UK Christmas: entry Mon 14 Dec, 10th session Tue 29 Dec (25 and 28 Dec closed), sell Wed 30 Dec.
  assert.deepEqual(exitBy({ kind: "bounce", market: "UK", entryDate: "2026-12-14" }), { lastClose: "2026-12-29", sellOpen: "2026-12-30", early: true });
});

test("exitBy: nothing without an entry date", () => {
  assert.equal(exitBy({ kind: "drift", market: "US" }), null);
});

test("heldLine: each holding with its sessions and sell date; bounces' early exit said once", () => {
  const open = [
    { kind: "drift", market: "UK", ticker: "BRBY", entryDate: "2026-11-13", sessions: 4, openPct: -1.57 },
    { kind: "bounce", market: "US", ticker: "ABT", entryDate: "2026-11-13", sessions: 4, openPct: -3.74 },
    { kind: "bounce", market: "US", ticker: "AMCR", entryDate: "2026-11-13", sessions: 1, openPct: 0.5 },
  ];
  assert.equal(heldLine(open), "Held: BRBY −1.6% (4 of 20 sessions, sells at the Fri 11 Dec open), ABT −3.7% (4 of up to 10, sells by the Mon 30 Nov open), AMCR +0.5% (1 of up to 10, sells by the Mon 30 Nov open). A bounce sells sooner, at the open after its first close above its 5-day average.");
  assert.equal(heldLine([open[0]]), "Held: BRBY −1.6% (4 of 20 sessions, sells at the Fri 11 Dec open).");
  assert.equal(heldLine([]), null);
});

test("heldLine: a bounce first still says sessions", () => {
  assert.match(heldLine([{ kind: "bounce", market: "US", ticker: "ABT", entryDate: "2026-11-13", sessions: 4, openPct: -3.74 }]), /^Held: ABT −3\.7% \(4 of up to 10 sessions, sells by the Mon 30 Nov open\)\. A bounce/);
});
