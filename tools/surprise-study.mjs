// Swing lab round 4: earnings surprise and the drift after results
// (src/surpriseStudy.js). S&P 500 only.
//   node tools/surprise-study.mjs [limit]   -> prints JSON summary
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { fetchEarningsHistory } from "../src/data/fundamentals.js";
import { surpriseEvents, analyseSurprise } from "../src/surpriseStudy.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
// REITs are left out: Yahoo's REIT forecasts mix FFO with earnings per share.
let universe = cons.indices.SP500.filter((u) => !/Real Estate|REIT/i.test(u.sector || ""));
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const idx = new Map((await fetchDaily("^GSPC", { range: "2y" })).rows.map((r) => [r.date, r.close]));
const all = [];
let done = 0, withHist = 0, failed = 0;
for (const u of universe) {
  try {
    const hist = await fetchEarningsHistory(u.symbol);
    if (hist.length) {
      withHist++;
      const { rows } = await fetchDaily(u.symbol, { range: "2y" });
      all.push(...surpriseEvents(rows, hist, { market: "US", idx, symbol: u.symbol }));
    }
  } catch { failed++; }
  if (++done % 100 === 0) console.error(`${done}/${universe.length} (${all.length} events)`);
  await sleep(250);
}
const dates = all.map((e) => e.date).sort();
console.log(JSON.stringify({ ran: new Date().toISOString().slice(0, 10), universe: universe.length, withHistory: withHist, failed, from: dates[0], to: dates.at(-1),
  ...analyseSurprise(all),
  sample: all.slice(0, 5).map(({ f, ...e }) => e) }, null, 1));
