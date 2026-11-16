// VWRP's biggest holdings for PLAN.coreHoldings in src/plan.js (16 Nov 2026).
// Refresh each quarter. stockanalysis.com is not reachable from the sandbox,
// so run on the runners (dryrun branch) and paste the printed list into the plan:
//   node tools/core-holdings.mjs            (fetches the page)
//   node tools/core-holdings.mjs page.html  (a saved copy)
// Keep only the names at 0.6% and above, as the plan does.
import { readFileSync } from "node:fs";
import { parseHoldingsPage, toCoreHoldings } from "../src/coreHoldings.js";

const URL = "https://stockanalysis.com/quote/lon/VWRP/holdings/";
const file = process.argv[2];
const html = file ? readFileSync(file, "utf8")
  : await (await fetch(URL, { headers: { "user-agent": "market-monitor (github.com/douglasbakeronline/market-monitor)" } })).text();
const { rows, date, count } = parseHoldingsPage(html);
if (!rows.length) { console.error("No holdings rows found: the page layout may have changed."); process.exit(1); }
const all = toCoreHoldings(rows), out = all.filter((h) => h.weight >= 0.6);
console.log(`// ${count ?? "?"} holdings, as of ${date ?? "unknown date"}`);
console.log(`coreHoldingsAsOf: "${date ? date.replace(/^(\w{3}) (\d+), (\d{4})$/, "$2 $1 $3") : "?"}",`);
for (const h of out) console.log(`    { symbol: "${h.symbol}", name: "${h.name}", weight: ${h.weight}${h.extra ? ", extra: true" : ""} },`);
if (all.unmapped.length) console.log(`// Not mapped (add to FOREIGN in src/coreHoldings.js if big enough): ${all.unmapped.join("; ")}`);
