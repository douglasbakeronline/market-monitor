// Monthly total returns for the Dashboard's goal odds (src/goalSim.js).
//   node tools/returns.mjs   -> writes data/returns.json
// S&P 500 total return (^SP500TR, dividends reinvested, US dollars) since 1988:
// the longest free total-return history. Also the same in pounds from 2004
// (GBPUSD=X), for comparison only. Refresh now and then (it changes slowly).
import { writeFile, mkdir } from "node:fs/promises";
import { parseYahoo } from "../src/data/prices.js";
import { fetchJson } from "../src/data/http.js";
import { monthEnds, monthlyReturns } from "../src/goalSim.js";

const daily = async (sym) => {
  const now = Math.floor(Date.now() / 1000);
  const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=-1325635200&period2=${now}&interval=1d`, { tries: 2 });
  const { rows } = parseYahoo(j.chart.result[0]);
  console.error(`${sym}: ${rows.length} bars from ${rows[0]?.date}`);
  return rows;
};

const tr = monthEnds(await daily("^SP500TR"));
const fx = monthEnds(await daily("GBPUSD=X"));
// Drop the current, unfinished month.
const thisMonth = new Date().toISOString().slice(0, 7);
const done = (xs) => xs.filter((x) => x.m < thisMonth);
const usd = monthlyReturns(done(tr));
const fxMap = new Map(done(fx).map((x) => [x.m, x.close]));
const inGbp = done(tr).filter((x) => fxMap.has(x.m)).map((x) => ({ m: x.m, close: x.close / fxMap.get(x.m) }));
const gbp = monthlyReturns(inGbp);
const out = {
  updated: new Date().toISOString().slice(0, 10),
  source: "Yahoo Finance: ^SP500TR (S&P 500 total return, USD) and GBPUSD=X",
  usd: { start: usd[0]?.m, end: usd.at(-1)?.m, r: usd.map((x) => Math.round(x.r * 1e5) / 1e5) },
  gbp: { start: gbp[0]?.m, end: gbp.at(-1)?.m, r: gbp.map((x) => Math.round(x.r * 1e5) / 1e5) },
};
await mkdir("data", { recursive: true });
await writeFile(process.env.OUT || "data/returns.json", JSON.stringify(out) + "\n");
const cagr = (r) => (Math.pow(r.reduce((a, x) => a * (1 + x), 1), 12 / r.length) - 1) * 100;
console.log(JSON.stringify({ usd: { from: out.usd.start, to: out.usd.end, months: out.usd.r.length, cagr: cagr(out.usd.r).toFixed(2) }, gbp: { from: out.gbp.start, months: out.gbp.r.length, cagr: cagr(out.gbp.r).toFixed(2) } }));
