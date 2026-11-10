// Swing lab backtest: the pre-registered short-term strategies in
// src/swingLab.js against random entry with the same exits, after costs,
// over every S&P 500 and FTSE 100 company.
//   node tools/swing-lab.mjs [limit] [range]   -> prints JSON summary
// range defaults to 10y (about nine years of trades after a year's warm-up).
// Caveat: today's index members only (survivorship flatters signal and
// random entries alike); raw closes (dividends not added, which is small over
// 10 to 20 sessions).
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { runStock, analyseLab, LAB_BAR } from "../src/swingLab.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
let universe = [
  ...cons.indices.SP500.map((x) => ({ ...x, market: "US" })),
  ...cons.indices.FTSE100.map((x) => ({ ...x, market: "UK" })),
];
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const range = process.argv[3] || "10y";

const index = {};
for (const [m, sym] of [["US", "^GSPC"], ["UK", "^FTSE"]]) {
  const { rows } = await fetchDaily(sym, { range });
  index[m] = new Map(rows.map((r) => [r.date, r.close]));
}

const trades = [];
let done = 0, fetched = 0, seed = 1;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range });
    if (rows.length >= 400) { fetched++; trades.push(...runStock(rows, u.market, { index: index[u.market], seed: seed++ })); }
  } catch { /* skip */ }
  if (++done % 100 === 0) console.error(`${done}/${universe.length}`);
  await sleep(100);
}
const dates = trades.map((t) => t.date).sort();
console.log(JSON.stringify({ universe: universe.length, fetched, range, from: dates[0], to: dates.at(-1), trades: trades.length, bar: LAB_BAR, results: analyseLab(trades) }, null, 1));
