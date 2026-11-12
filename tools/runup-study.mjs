// Swing lab round 5: the run-up into results (src/runupStudy.js).
//   node tools/runup-study.mjs [limit] [range] [dates]   -> prints JSON summary
// dates: "volume" (run 1, pre-registered: busiest-day guess) or "yahoo" (run 2,
// 12 Nov: Yahoo's timed results dates, after D1 failed). Same universe and
// caveats as tools/drift-study.mjs (today's S&P 500 and FTSE 100 members).
// D1 for run 1 compares found days with history/results-dates.json (US); for
// run 2, Yahoo's dates with the hand-checked data/results-dates-known.json.
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { fetchReportedDates } from "../src/data/fundamentals.js";
import { runupEvents, analyseRunup, matchRate, daysFromDates } from "../src/runupStudy.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
const known = JSON.parse(await readFile("history/results-dates.json", "utf8").catch(() => "{}"));
const hand = JSON.parse(await readFile("data/results-dates-known.json", "utf8").catch(() => "{}"));
let universe = [...cons.indices.SP500.map((x) => ({ ...x, market: "US" })), ...cons.indices.FTSE100.map((x) => ({ ...x, market: "UK" }))];
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const range = process.argv[3] || "10y", mode = process.argv[4] || "volume";
const index = {};
for (const [m, sym] of [["US", "^GSPC"], ["UK", "^FTSE"]]) index[m] = new Map((await fetchDaily(sym, { range })).rows.map((r) => [r.date, r.close]));
const all = [], match = { n: 0, hit: 0 };
let done = 0, fetched = 0, withDates = 0, seed = 1, nDates = 0;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range });
    if (rows.length >= 400) {
      fetched++;
      let days = null;
      if (mode === "yahoo") {
        const ev = await fetchReportedDates(u.symbol, { size: 60 });
        days = daysFromDates(rows, ev);
        if (days.length) withDates++;
        nDates += days.length;
        for (const k of hand.dates?.[u.symbol] ?? []) { match.n++; if (ev.some((e) => Math.abs(Date.parse(e.date) - Date.parse(k)) <= 864e5)) match.hit++; }
      } else if (u.market === "US" && known[u.symbol]?.length) { const m = matchRate(rows, known[u.symbol]); match.n += m.n; match.hit += m.hit; }
      all.push(...runupEvents(rows, u.market, { idx: index[u.market], seed: seed++, symbol: u.symbol, days }));
    }
  } catch { /* skip */ }
  if (++done % 100 === 0) console.error(`${done}/${universe.length}`);
  await sleep(mode === "yahoo" ? 200 : 100);
}
const dates = all.map((e) => e.date).sort();
console.log(JSON.stringify({ ran: new Date().toISOString().slice(0, 10), mode, universe: universe.length, fetched, withDates, resultsDays: nDates, range, from: dates[0], to: dates.at(-1), ...analyseRunup(all, { match }) }, null, 1));
