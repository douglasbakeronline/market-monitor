// Swing lab round 5: the run-up into results (src/runupStudy.js).
//   node tools/runup-study.mjs [limit] [range]   -> prints JSON summary
// Same universe and caveats as tools/drift-study.mjs (today's S&P 500 and
// FTSE 100 members). D1 compares found results days with the real dates kept
// in history/results-dates.json (US stocks).
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { runupEvents, analyseRunup, matchRate } from "../src/runupStudy.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
const known = JSON.parse(await readFile("history/results-dates.json", "utf8").catch(() => "{}"));
let universe = [...cons.indices.SP500.map((x) => ({ ...x, market: "US" })), ...cons.indices.FTSE100.map((x) => ({ ...x, market: "UK" }))];
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const range = process.argv[3] || "10y";
const index = {};
for (const [m, sym] of [["US", "^GSPC"], ["UK", "^FTSE"]]) index[m] = new Map((await fetchDaily(sym, { range })).rows.map((r) => [r.date, r.close]));
const all = [], match = { n: 0, hit: 0 };
let done = 0, fetched = 0, seed = 1;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range });
    if (rows.length >= 400) {
      fetched++;
      all.push(...runupEvents(rows, u.market, { idx: index[u.market], seed: seed++, symbol: u.symbol }));
      if (u.market === "US" && known[u.symbol]?.length) { const m = matchRate(rows, known[u.symbol]); match.n += m.n; match.hit += m.hit; }
    }
  } catch { /* skip */ }
  if (++done % 100 === 0) console.error(`${done}/${universe.length}`);
  await sleep(100);
}
const dates = all.map((e) => e.date).sort();
console.log(JSON.stringify({ ran: new Date().toISOString().slice(0, 10), universe: universe.length, fetched, range, from: dates[0], to: dates.at(-1), ...analyseRunup(all, { match }) }, null, 1));
