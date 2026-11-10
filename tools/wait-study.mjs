// "Buy now or wait for the pullback rule?" by distance from the 52-week high
// (src/waitStudy.js), for the Dashboard's money check.
//   node tools/wait-study.mjs   -> writes data/wait-study.json
// S&P 500 (^GSPC, since 1950) and FTSE 100 (^FTSE, since 1984), daily closes,
// price only (dividends add roughly 0.5% over a 3-month wait).
import { writeFile, mkdir } from "node:fs/promises";
import { parseYahoo } from "../src/data/prices.js";
import { fetchJson } from "../src/data/http.js";
import { waitStudy } from "../src/waitStudy.js";

const daily = async (sym, from) => {
  const now = Math.floor(Date.now() / 1000);
  const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${from}&period2=${now}&interval=1d`, { tries: 2 });
  const { rows } = parseYahoo(j.chart.result[0]);
  console.error(`${sym}: ${rows.length} bars from ${rows[0]?.date}`);
  return rows.filter((r) => r.close > 0);
};
const sp = await daily("^GSPC", -631152000); // 1950
const ftse = await daily("^FTSE", 441763200); // 1984
const out = { updated: new Date().toISOString().slice(0, 10), source: "Yahoo Finance daily closes, price only", sp: waitStudy(sp), ftse: waitStudy(ftse) };
await mkdir("data", { recursive: true });
await writeFile(process.env.OUT || "data/wait-study.json", JSON.stringify(out) + "\n");
for (const k of ["sp", "ftse"]) {
  console.log(k, out[k].from, out[k].to, "all m3", JSON.stringify(out[k].all.fwd.m3));
  for (const b of out[k].bands) console.log(` ${b.band}: days ${b.days} | m1 ${b.fwd.m1.median} (${b.fwd.m1.positive}% up) m12 ${b.fwd.m12.median} (${b.fwd.m12.positive}% up) | wait: hit ${b.wait.hitShare}% in ${b.wait.hitDays}d saving ${b.wait.savingIfHit}%, missed ${b.wait.savingIfMissed}%, mean ${b.wait.meanSaving}%, better ${b.wait.betterShare}%`);
}
