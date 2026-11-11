import { test } from "node:test";
import assert from "node:assert/strict";
import { potOrderSize, SPOT } from "../src/shortPot.js";

const pot = (o = {}) => ({ rules: SPOT, value: 10000, open: [], ...o });

test("potOrderSize: a fifth of the saved short-term pot", () => {
  const r = potOrderSize(pot(), { swing: 5000, saved: "2026-11-11" });
  assert.deepEqual(r, { real: 5000, each: 1000, basis: "saved", saved: "2026-11-11" });
});

test("potOrderSize: follows the pot book's move since the value was saved", () => {
  const r = potOrderSize(pot({ value: 11000 }), { swing: 5000, potAt: { value: 10000 }, saved: "2026-11-12" });
  assert.equal(r.basis, "moved"); assert.equal(r.real, 5500); assert.equal(r.each, 1100);
  assert.equal(potOrderSize(pot(), { swing: 5000, potAt: { value: 10000 } }).basis, "saved");
});

test("potOrderSize: open losses do not shrink the next buy (as in the book)", () => {
  // Book: 10,000 closed value, one open trade of 2,000 down 50%: value 9,000.
  const r = potOrderSize(pot({ value: 9000, open: [{ openPnl: -1000 }] }), { swing: 4500, potAt: { value: 9000 } });
  assert.equal(r.real, 4500);
  assert.equal(r.each, 1000, "a fifth of 10,000 notional, scaled to the real pot");
});

test("potOrderSize: 10% of the other pots when no short-term value is saved; null without pots", () => {
  const r = potOrderSize(pot(), { core: 6000, reserve: 1500, picks: 1500 });
  assert.equal(r.basis, "target"); assert.equal(r.real, 1000); assert.equal(r.each, 200);
  assert.equal(potOrderSize(pot(), null), null);
  assert.equal(potOrderSize(pot(), {}), null);
  assert.equal(potOrderSize(null, { swing: 100 }), null);
});
