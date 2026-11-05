// Research: forward 6 and 12-month returns of index stocks by distance from
// the 52-week high and by 12-1 month momentum (src/entryTest.js).
//   node tools/entry-test.mjs [limit] [range]   -> prints JSON summary
//   range defaults to 10y. Today's index members only (survivorship bias).
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { samples, relativise, analyse } from "../src/entryTest.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
let universe = Object.entries(cons.indices).flatMap(([idx, xs]) => xs.map((x) => ({ ...x, market: idx === "FTSE100" ? "UK" : "US" })));
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const range = process.argv[3] || "10y";

const all = { US: [], UK: [] };
let done = 0, fetched = 0;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range });
    const s = samples(rows, u.symbol);
    if (s.length) { fetched++; all[u.market].push(...s); }
  } catch { /* skip */ }
  if (++done % 100 === 0) console.error(`${done}/${universe.length}`);
  await sleep(100);
}

// Relativise within each market (US and UK months are compared separately).
const us = relativise(all.US, 30), uk = relativise(all.UK, 20);
console.log(JSON.stringify({ universe: universe.length, fetched, range, all: analyse([...us, ...uk]), US: analyse(us), UK: analyse(uk) }, null, 1));
