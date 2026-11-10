// Research: do sell and risk signals (src/sellSignals.js) tell a holder
// anything? For every S&P 500 and FTSE 100 member over about four years, each
// signal's forward return against the home index (S&P 500 or FTSE 100) after
// 1 week, 1 month and 3 months, compared with the same universe's average day.
// One signal of a kind per stock per month. Price only; today's members only
// (survivorship bias lifts the baseline and the signals alike).
//   node tools/sell-study.mjs [limit]   -> writes data/sell-study.json
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { prepare, sellSignalsAt, summariseSell } from "../src/sellSignals.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
let universe = Object.entries(cons.indices).filter(([k]) => k === "SP500" || k === "FTSE100").flatMap(([idx, xs]) => xs.map((x) => ({ ...x, market: idx === "FTSE100" ? "UK" : "US" })));
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const H = { d5: 5, d21: 21, d63: 63 };
const idx = {};
for (const [m, s] of [["US", "^GSPC"], ["UK", "^FTSE"]]) { const { rows } = await fetchDaily(s, { range: "5y" }); idx[m] = new Map(rows.map((r) => [r.date, r.close])); }
const events = [], baseline = [];
let ok = 0;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range: "5y" });
    if (rows.length < 400) continue;
    ok++;
    const p = prepare(rows), I = idx[u.market];
    const ex = (i, h) => {
      const j = i + h; if (j >= rows.length) return null;
      const a = I.get(rows[i].date), b = I.get(rows[j].date);
      if (!(a > 0) || !(b > 0)) return null;
      return ((rows[j].close / rows[i].close) - (b / a)) * 100;
    };
    const last = {};
    for (let i = 252; i < rows.length; i++) {
      if (i % 5 === 0) baseline.push(Object.fromEntries(Object.entries(H).map(([k, h]) => [k, ex(i, h)])));
      for (const k of sellSignalsAt(p, i)) {
        if (last[k] != null && i - last[k] < 21) continue;
        last[k] = i;
        events.push({ kind: k, market: u.market, date: rows[i].date, ...Object.fromEntries(Object.entries(H).map(([kk, h]) => [kk, ex(i, h)])) });
      }
    }
  } catch { /* skip */ }
  await sleep(150);
}
const all = summariseSell(events, baseline);
const us = summariseSell(events.filter((e) => e.market === "US"), baseline);
const uk = summariseSell(events.filter((e) => e.market === "UK"), baseline);
const dates = events.map((e) => e.date).sort();
const out = { updated: new Date().toISOString().slice(0, 10), stocks: ok, events: events.length, from: dates[0], to: dates.at(-1), all, us, uk };
await mkdir("data", { recursive: true });
await writeFile(process.env.OUT || "data/sell-study.json", JSON.stringify(out) + "\n");
console.log(`stocks ${ok}, events ${events.length}, ${out.from} to ${out.to}; average day vs index: ${JSON.stringify(all.base)}`);
for (const [k, r] of Object.entries(all.byKind)) console.log(`${k}: n ${r.n} | 1w ${r.d5.vsAverage} (t ${r.d5.t}) | 1m ${r.d21.vsAverage} (t ${r.d21.t}, worse ${r.d21.worse}%) | 3m ${r.d63.vsAverage} (t ${r.d63.t}) | ${r.verdict} | US 1m ${us.byKind[k].d21.vsAverage} UK 1m ${uk.byKind[k].d21.vsAverage}`);
