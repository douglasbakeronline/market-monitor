// Swing lab round 2: post-results drift by holding period, sample half and
// market, the down-day mirror (for pick tranches), and exploratory cuts.
//   node tools/drift-study.mjs [limit] [range]   -> prints JSON summary
// Same universe and caveats as tools/swing-lab.mjs.
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { driftEvents, analyseDrift } from "../src/driftStudy.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
let universe = [...cons.indices.SP500.map((x) => ({ ...x, market: "US" })), ...cons.indices.FTSE100.map((x) => ({ ...x, market: "UK" }))];
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const range = process.argv[3] || "10y";
const index = {};
for (const [m, sym] of [["US", "^GSPC"], ["UK", "^FTSE"]]) index[m] = new Map((await fetchDaily(sym, { range })).rows.map((r) => [r.date, r.close]));
const all = [];
let done = 0, fetched = 0, seed = 1;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range });
    if (rows.length >= 400) { fetched++; all.push(...driftEvents(rows, u.market, { idx: index[u.market], seed: seed++ })); }
  } catch { /* skip */ }
  if (++done % 100 === 0) console.error(`${done}/${universe.length}`);
  await sleep(100);
}
const dates = all.map((e) => e.date).sort();
console.log(JSON.stringify({ universe: universe.length, fetched, range, from: dates[0], to: dates.at(-1), ...analyseDrift(all) }, null, 1));
