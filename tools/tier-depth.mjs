// Research: after a first close at a buy tier, how often did the fall go
// deeper, how fast, and how long until the tiers re-armed? (src/tierDepth.js)
//   node tools/tier-depth.mjs            -> prints JSON
//   node tools/tier-depth.mjs --write    -> also writes data/tier-depth.json
// Run on the dryrun runner (Yahoo is blocked from the sandbox). Refresh once a
// year, or after a fall that reached a tier has ended.
import { writeFile } from "node:fs/promises";
import { parseYahoo } from "../src/data/prices.js";
import { fetchJson } from "../src/data/http.js";
import { tierDepth } from "../src/tierDepth.js";

const daily = async (sym) => {
  const now = Math.floor(Date.now() / 1000);
  const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=-1325635200&period2=${now}&interval=1d`, { tries: 2 });
  const { rows } = parseYahoo(j.chart.result[0]);
  if (rows.length < 2000) throw new Error(`only ${rows.length} daily bars for ${sym}`);
  console.error(`${sym}: ${rows.length} bars from ${rows[0].date} to ${rows.at(-1).date}`);
  return rows;
};

const [sp, ftse] = await Promise.all(["^GSPC", "^FTSE"].map(daily));
// The headline sample (shown on the Dashboard) is fixed before looking: the
// S&P 500 since 1950 (post-war market, daily data throughout) and the FTSE 100
// since its first full year. 1928 and 1990 are kept for the research log.
const out = {
  generated: new Date().toISOString().slice(0, 10),
  note: "Episodes start at the first close 10%+ below the 52-week closing high and end at the first close back within 5% (where the tiers re-arm). Price index, no dividends. Sessions are trading days.",
  sp: tierDepth(sp, { from: "1950-01-01" }),
  ftse: tierDepth(ftse),
  extra: { sp1928: tierDepth(sp), sp1990: tierDepth(sp, { from: "1990-01-01" }) },
};
console.log(JSON.stringify(out, null, 1));
if (process.argv.includes("--write")) {
  await writeFile("data/tier-depth.json", JSON.stringify(out, null, 1) + "\n");
  console.error("wrote data/tier-depth.json");
}
