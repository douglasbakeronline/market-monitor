import { test } from "node:test";
import assert from "node:assert/strict";
import { byKind, MIN_PER_KIND } from "../src/trackRecord.js";

const sig = (kind, now, vsSp, sessions = 10, m1 = null) => ({ kind, symbol: "X", date: "2026-11-01", perf: { now, vsSp, sessions, m1 } });

test("byKind groups signals and holds rates back until enough are scored", () => {
  const log = [
    ...Array.from({ length: MIN_PER_KIND }, (_, i) => sig("research-swing", i < 3 ? 2 : -1, i < 2 ? 1 : -0.5)),
    sig("research-lt", 3, 1), sig("research-lt", 1, 0.5, 2),
    sig("greed", -2, -1), 
  ];
  const g = byKind(log);
  assert.equal(g[0].kind, "research-swing");
  assert.equal(g[0].total, MIN_PER_KIND);
  assert.equal(g[0].hitRate, 60);
  assert.equal(g[0].beatSp, 40);
  assert.equal(g[0].avgVsSp, 0.1);
  const lt = g.find((x) => x.kind === "research-lt");
  assert.equal(lt.total, 2);
  assert.equal(lt.scored, 1, "a signal under a week old is not scored");
  assert.equal(lt.enough, false);
  assert.equal(lt.hitRate, null);
  assert.equal(lt.label, "Long-term good entry");
  assert.deepEqual(byKind([]), []);
});
