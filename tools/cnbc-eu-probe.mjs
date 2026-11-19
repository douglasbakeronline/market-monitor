// Backup prices for European listings (roadmap Later: backup price source
// follow-up b). Run on a dry-run runner (Yahoo and CNBC are blocked from the
// sandbox): for every European name in scan.json, try CNBC symbol spellings
// and compare the last 60 common closes with Yahoo's. Prints one line per name
// and a summary per exchange; maps nothing by itself. --uk checks London
// listings instead (spellings "BA-GB" and "BA.-GB").
import { readFileSync } from "node:fs";
import { fetchDaily } from "../src/data/prices.js";
import { fetchJson } from "../src/data/http.js";
import { parseCnbcBars } from "../src/data/cnbc.js";

const CAND = { L: ["GB", ".-GB"], PA: ["FR", "PA"], DE: ["DE", "XE", "GY"], AS: ["NL", "AE", "AS"], MI: ["IT", "MI"], MC: ["ES", "MC"], BR: ["BE", "BR"], HE: ["FI", "HE"] };
const scan = JSON.parse(readFileSync("scan.json", "utf8"));
const uk = process.argv.includes("--uk");
const eu = scan.items.map((i) => i.symbol).filter((s) => (uk ? /\.L$/ : /\.(PA|DE|AS|MI|MC|BR|HE)$/).test(s));
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = arg ? arg.split(",") : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byEx = {};
for (const sym of only ?? eu) {
  const [, base, ex] = /^(.+)\.([A-Z]+)$/.exec(sym);
  let y;
  try { y = await fetchDaily(sym, { range: "1y", backup: false }); } catch (e) { console.log(`${sym}: Yahoo failed (${e.message})`); continue; }
  const ymap = new Map(y.rows.map((r) => [r.date, r.close]));
  let found = null;
  const tried = [];
  for (const cc of CAND[ex]) {
    const b = ex === "L" ? base.replace("-", ".") : base.replace(/-.*$/, "");
    const cs = cc.startsWith(".") ? `${b}${cc}` : `${b}-${cc}`;
    try {
      const j = await fetchJson(`https://ts-api.cnbc.com/harmony/app/charts/1Y.json?symbol=${encodeURIComponent(cs)}`, { tries: 1 });
      const rows = parseCnbcBars(j);
      const common = rows.filter((r) => ymap.has(r.date)).slice(-60);
      if (common.length < 30) { tried.push(`${cs} ${rows.length} bars, ${common.length} common`); continue; }
      const diffs = common.map((r) => Math.abs(r.close / ymap.get(r.date) - 1) * 100);
      const max = Math.max(...diffs), exact = diffs.filter((d) => d < 0.01).length;
      const qj = await fetchJson(`https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(cs)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`, { tries: 1 }).catch(() => null);
      const q = qj?.FormattedQuoteResult?.FormattedQuote?.[0];
      found = { cs, n: common.length, exact, max: +max.toFixed(3), cur: q?.currencyCode ?? null, ycur: y.currency, last: rows.at(-1)?.date, ylast: y.rows.at(-1)?.date };
      break;
    } catch (e) { tried.push(`${cs} ${e.message.slice(0, 60)}`); }
    await sleep(300);
  }
  const ok = found && found.max < 0.5 && found.exact >= found.n * 0.9;
  (byEx[ex] ??= { ok: 0, of: 0, cc: new Set() }).of++;
  if (ok) { byEx[ex].ok++; byEx[ex].cc.add(found.cs.split("-").pop()); }
  console.log(`${sym}: ${found ? `${found.cs} ${found.exact}/${found.n} exact, max diff ${found.max}%, ${found.cur} vs Yahoo ${found.ycur}, last ${found.last} vs ${found.ylast}${ok ? " MATCH" : " MISMATCH"}` : "no CNBC spelling worked"}${tried.length ? ` [tried: ${tried.join("; ")}]` : ""}`);
  await sleep(300);
}
console.log("\nBy exchange:");
for (const [ex, v] of Object.entries(byEx)) console.log(`${ex}: ${v.ok} of ${v.of} match (${[...v.cc].join(", ") || "none"})`);
