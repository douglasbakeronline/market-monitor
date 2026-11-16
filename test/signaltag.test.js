import { test } from "node:test";
import assert from "node:assert/strict";
import { signalPotTag } from "../src/shortPot.js";

const pot = (o = {}) => ({ rules: { maxOpen: 5, today: "2026-11-13" }, open: [], buys: [], sells: [], skipList: [], free: 5, paused: false, ...o });
const sig = (symbol, kind = "bounce", date = "2026-11-13") => ({ symbol, kind, date });

test("signalPotTag: a buy, a holding, the skip list, a full or paused pot", () => {
  assert.equal(signalPotTag(sig("PSA"), pot({ buys: [{ symbol: "PSA", kind: "bounce" }], free: 1 })).key, "buy");
  assert.equal(signalPotTag(sig("AMCR"), pot({ open: [{ symbol: "AMCR" }], free: 0 })).key, "held");
  assert.equal(signalPotTag(sig("BRBY.L", "drift"), pot({ skipList: [{ symbol: "BRBY.L", from: "2026-11-12" }] })).key, "skip");
  assert.equal(signalPotTag(sig("BRBY.L", "drift", "2026-11-11"), pot({ rules: { maxOpen: 5, today: "2026-11-11" }, skipList: [{ symbol: "BRBY.L", from: "2026-11-12" }] })).key, "ranked");
  const full = signalPotTag(sig("VRTX"), pot({ open: [1, 2, 3, 4, 5].map((i) => ({ symbol: `X${i}` })), free: 0 }));
  assert.equal(full.key, "full");
  assert.match(full.text, /all 5 slots held/);
  assert.equal(signalPotTag(sig("VRTX"), pot({ paused: true, free: 0 })).key, "paused");
  assert.equal(signalPotTag(sig("IQV"), pot({ buys: [{ symbol: "PSA" }], free: 1 })).key, "ranked");
});

test("signalPotTag: a held name being sold at the next open is not 'held'", () => {
  const p = pot({ open: [], sells: [{ symbol: "AMCR" }], free: 0 });
  assert.equal(signalPotTag(sig("AMCR"), p).key, "full");
});

test("signalPotTag: no pot, or a list from another close, gets no tag", () => {
  assert.equal(signalPotTag(sig("PSA"), null), null);
  assert.equal(signalPotTag(sig("PSA", "bounce", "2026-11-12"), pot()), null);
});
