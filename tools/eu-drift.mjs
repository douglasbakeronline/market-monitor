// Swing lab follow-up (b): post-results drift on Euro Stoxx 50 names,
// pre-registered in src/euDrift.js (read it first).
//   node tools/eu-drift.mjs [range]   -> prints JSON summary
// Same caveats as tools/swing-lab.mjs: today's members only (survivorship
// flatters signal and random entries alike); raw closes, no dividends.
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { runStock, analyseLab, LAB_BAR } from "../src/swingLab.js";
import { roundTripCost } from "../src/swingRetune.js";
import { euDriftCheck, EU_BAR } from "../src/euDrift.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
const universe = cons.indices.EUROSTOXX50;
const range = process.argv[2] || "10y";
const index = new Map((await fetchDaily("^STOXX50E", { range })).rows.map((r) => [r.date, r.close]));

const trades = [], missing = [];
let seed = 1;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range });
    if (rows.length >= 400) trades.push(...runStock(rows, "EU", { index, seed: seed++, cost: roundTripCost(u.symbol, "EU") }).map((t) => ({ ...t, symbol: u.symbol })));
    else missing.push(`${u.symbol} (${rows.length} bars)`);
  } catch (e) { missing.push(`${u.symbol} (${e.message})`); }
  await sleep(150);
}
const sig = trades.filter((t) => t.strategy === "drift" && !t.stop && t.kind === "signal");
const vsIdx = sig.filter((t) => t.idx != null);
const lab = analyseLab(trades).map((r) => ({ key: r.key, stop: r.stop, n: r.signal.n, avg: r.signal.avg, base: r.baseline.avg, edge: r.edge, t: r.tEdge, yearsAhead: r.yearsAhead, yearsCounted: r.yearsCounted, labChecks: r.checks }));
const dates = sig.map((t) => t.date).sort();
const byCountry = Object.fromEntries([...new Set(sig.map((t) => t.symbol.split(".")[1]))].sort().map((c) => {
  const xs = sig.filter((t) => t.symbol.endsWith(`.${c}`));
  return [c, { n: xs.length, avg: Math.round((xs.reduce((a, t) => a + t.net, 0) / xs.length) * 100) / 100 }];
}));
console.log(JSON.stringify({
  universe: universe.length, fetched: universe.length - missing.length, missing, range, from: dates[0], to: dates.at(-1),
  euBar: EU_BAR, drift: euDriftCheck(trades), driftVsIndex: vsIdx.length ? Math.round((vsIdx.reduce((a, t) => a + t.net - t.idx, 0) / vsIdx.length) * 100) / 100 : null,
  byCountry, labBar: LAB_BAR, lab,
}, null, 1));
