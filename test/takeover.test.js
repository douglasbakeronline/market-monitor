import { test } from "node:test";
import assert from "node:assert/strict";
import { shortTermAlert, bigJump, BIG_JUMP } from "../src/shortTerm.js";

const st = (movePct) => ({ date: "2026-11-11", drift: [{ kind: "drift", symbol: "X", ticker: "X", name: "X Corp", movePct, volX: 5, results: false }], bounce: [],
  pot: { rules: { maxOpen: 5 }, open: [], buys: [{ kind: "drift", symbol: "X", ticker: "X", name: "X Corp", market: "US" }], sells: [], paused: false } });

test("bigJump: drift moves of 12%+ only", () => {
  assert.equal(BIG_JUMP, 12);
  assert.equal(bigJump({ kind: "drift", movePct: 12 }), true);
  assert.equal(bigJump({ kind: "drift", movePct: 11.9 }), false);
  assert.equal(bigJump({ kind: "bounce", movePct: 30 }), false);
  assert.equal(bigJump(null), false);
});

test("shortTermAlert: a 12%+ jump asks to check for a takeover offer; the order is unchanged", () => {
  const a = shortTermAlert(st(25));
  assert.match(a.title, /buy X/);
  assert.match(a.body, /takeover offer: check the news first/);
  assert.doesNotMatch(shortTermAlert(st(6)).body, /takeover/);
  // Without a pot (paper list) the note shows on the signal line too.
  const b = shortTermAlert({ ...st(30), pot: null });
  assert.match(b.body, /- X \(X\): results drift.*takeover/);
});
