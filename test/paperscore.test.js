import { test } from "node:test";
import assert from "node:assert/strict";
import { paperDigestLine } from "../src/paperScore.js";

test("digest line covers the books that have started", () => {
  assert.equal(paperDigestLine({}), null);
  const plan = { rules: { equity0: 10000 }, variants: { agreed: { started: "d", value: 10120 }, vwrp: { started: "d", value: 10150 }, weakHold: { started: "d", value: 10100 }, buffettPot: { started: null } } };
  const line = paperDigestLine({ plan, swing: { start: "2026-11-02", returnPct: -2.41, sp: { pct: -0.78 } }, drift: { start: null },
    lensEvents: [{ kind: "zone", date: "2026-11-11", left: null, h: {} }] });
  assert.match(paperDigestLine({ plan: { rules: { equity0: 10000 }, variants: { agreed: { started: "d", value: 9999.35 }, vwrp: { started: "d", value: 10000 } } } }), /plan 0\.0% vs all-VWRP 0\.0%/);
  assert.equal(line, "Paper books since start: plan +1.2% vs all-VWRP +1.5% (with the weak-results hold +1.0%); swing -2.4% (S&P -0.8%). Buffett lens: 1 in the buy zone.");
});
