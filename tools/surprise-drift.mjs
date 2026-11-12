// Swing lab round 6: results drift on real results days, with the analysts'
// surprise (src/surpriseDrift.js). S&P 500 and FTSE 100, ten years.
//   node tools/surprise-drift.mjs [limit] [range]   -> prints JSON summary
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { fetchResultsHistory } from "../src/data/fundamentals.js";
import { surpriseDriftEvents, analyseSurpriseDrift, analyseWeakFalls } from "../src/surpriseDrift.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
let universe = [...cons.indices.SP500.map((x) => ({ ...x, market: "US" })), ...cons.indices.FTSE100.map((x) => ({ ...x, market: "UK" }))];
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const range = process.argv[3] || "10y";
const index = {};
for (const [m, sym] of [["US", "^GSPC"], ["UK", "^FTSE"]]) index[m] = new Map((await fetchDaily(sym, { range })).rows.map((r) => [r.date, r.close]));
const all = [];
let done = 0, fetched = 0, withDates = 0, seed = 1;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range });
    if (rows.length >= 400) {
      const ev = await fetchResultsHistory(u.symbol, { size: 60 });
      fetched++;
      // Stocks with no dates add nothing (their volume shocks cannot be told
      // apart from results days).
      if (ev.length) { withDates++; all.push(...surpriseDriftEvents(rows, u.market, ev, { idx: index[u.market], seed: seed++, symbol: u.symbol })); }
    }
  } catch { /* skip */ }
  if (++done % 100 === 0) console.error(`${done}/${universe.length}`);
  await sleep(200);
}
const dates = all.map((e) => e.date).sort();
const res = analyseSurpriseDrift(all);
const brief = (t) => { const { byYear, ...x } = t; return { ...x, byYear: byYear.map((y) => [y.year, y.n, y.edge]) }; };
console.log(JSON.stringify({ ran: new Date().toISOString().slice(0, 10), universe: universe.length, fetched, withDates, range, from: dates[0], to: dates.at(-1),
  H10: analyseWeakFalls(all), D2: res.D2, H7: res.H7, H8: res.H8, H9: res.H9, counts: res.counts, random: res.random, groups: Object.fromEntries(Object.entries(res.groups).map(([k, v]) => [k, brief(v)])) }, null, 1));
