import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, costR, resultsNear, VARIANTS } from "../src/swingRetune.js";

const tr = (o) => ({ status: "closed", exitDate: "2025-06-01", market: "US", entry: 100, risk: 5, r: 1, score: 70, uptrend: true, resultsNear: false, ...o });

test("costs in R: US pays FX both ways, UK pays stamp duty", () => {
  assert.equal(costR(tr({})).toFixed(2), "0.06");
  assert.equal(costR(tr({ market: "UK" })).toFixed(2), "0.10");
  assert.equal(costR(tr({ risk: 0 })), 0);
});

test("variants filter trades and compare with the matching baseline", () => {
  const trades = [tr({ score: 80, r: 2 }), tr({ score: 66, r: -1 }), tr({ market: "UK", score: 80, r: -1 }), tr({ uptrend: false, score: 80, r: 0.5 })];
  const base = [tr({ r: 0.2 }), tr({ market: "UK", r: 0 }), tr({ uptrend: false, r: -0.5 })];
  const out = Object.fromEntries(analyse(trades, base).map((v) => [v.key, v]));
  assert.equal(out.all.n, 4);
  assert.equal(out.s75.n, 3);
  assert.equal(out.s75upUS.n, 1);
  assert.equal(out.s75upUS.netR, 1.94);
  assert.equal(out.s75upUS.base.n, 1); // baseline ignores the score, keeps US + uptrend
  assert.equal(out.s75upUS.edge, 1.8);
  assert.equal(out.s75upUS.clear, false); // too few trades
  assert.equal(out.all.base.n, 3);
});

test("a clear winner needs sample, positive net, edge and most years ahead", () => {
  const years = ["2023", "2024", "2025", "2026"];
  const trades = years.flatMap((y) => Array.from({ length: 60 }, (_, i) => tr({ exitDate: `${y}-03-01`, score: 80, r: i % 2 ? 1.5 : -0.8 })));
  const base = years.flatMap((y) => Array.from({ length: 60 }, (_, i) => tr({ exitDate: `${y}-03-01`, r: i % 2 ? 1 : -0.9 })));
  const v = analyse(trades, base).find((x) => x.key === "s75");
  assert.equal(v.n, 240);
  assert.equal(v.yearsCounted, 4);
  assert.equal(v.clear, true);
  const worse = analyse(trades, base.map((t) => ({ ...t, r: t.r + 0.5 }))).find((x) => x.key === "s75");
  assert.equal(worse.clear, false);
  assert.equal(VARIANTS[0].key, "all");
});

test("results projected on a quarterly grid from any known date", () => {
  const anchors = ["2026-10-28"];
  assert.equal(resultsNear("2026-10-20", anchors), true); // 8 days before
  assert.equal(resultsNear("2026-07-25", anchors), true); // ~91 days earlier
  assert.equal(resultsNear("2026-09-10", anchors), false); // mid-quarter
  assert.equal(resultsNear("2025-10-25", anchors), true); // a year back
  assert.equal(resultsNear("2026-09-10", []), false);
});
