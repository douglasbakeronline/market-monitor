// Research (8 Nov): do new or added 13F positions of the tracked managers
// (src/smartMoney.js MANAGERS) beat the S&P 500 once the filing is public?
// Filings from 13f.info (one-off, politely paced: about 2 requests per
// filing), prices from Yahoo (price only; SPY and the equal-weight RSP as
// benchmarks, since the median stock trailed the cap-weighted index in 2023-25).
//   node tools/smart-backtest.mjs [years=5] [outFile]
import { writeFile } from "node:fs/promises";
import { MANAGERS, parse13fInfoFilings, parse13fInfoData, aggregate } from "../src/smartMoney.js";
import { quarterEvents, forward, analyse, sameCompany } from "../src/smartBacktest.js";
import { fetchDaily } from "../src/data/prices.js";
import { sleep } from "../src/util.js";

const years = +(process.argv[2] || 5);
const outFile = process.argv[3] || "dry-run/smart-backtest.json";
const cutoff = `${new Date().getUTCFullYear() - years}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
const UA = { "User-Agent": "market-monitor research (github.com/douglasbakeronline/market-monitor)" };

async function get(url, as = "json") {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(url, { headers: UA, redirect: "follow" });
    if (r.ok) return as === "json" ? r.json() : r.text();
    if (r.status === 404) throw new Error(`404 ${url}`);
    await sleep(4000 * (t + 1));
    if (t === 2) throw new Error(`${r.status} ${url}`);
  }
}

const events = [], problems = [], loaded = {};
for (const m of MANAGERS) {
  try {
    const html = await get(`https://13f.info/manager/${m.cik}`, "text");
    // Filings in the window plus one earlier quarter as the base for the first diff.
    const all = parse13fInfoFilings(html);
    const keep = all.filter((f) => f.period >= cutoff);
    const base = all.find((f) => f.period < cutoff);
    const list = base ? [...keep, base] : keep;
    const filings = [];
    for (const f of list) {
      await sleep(2500);
      try {
        const { rows, tickers } = parse13fInfoData(await get(`https://13f.info/data/13f/${f.acc}`));
        filings.push({ period: f.period, filed: f.filed, holdings: aggregate(rows).map((h) => ({ ...h, ticker: tickers[h.cusip] || null })) });
      } catch (e) { problems.push(`${m.name} ${f.period}: ${e.message}`); }
    }
    loaded[m.name] = filings.map((f) => f.period).sort();
    events.push(...quarterEvents(m.name, filings));
    console.error(`${m.name}: ${filings.length} filings, ${events.length} events so far`);
  } catch (e) { problems.push(`${m.name}: ${e.message}`); }
  await sleep(2500);
}

const bench = (await fetchDaily("SPY", { range: "10y" })).rows;
const benchEw = (await fetchDaily("RSP", { range: "10y" })).rows;
const prices = {}, names = {};
const tickers = [...new Set(events.map((e) => e.ticker).filter(Boolean))];
for (const t of tickers) {
  try { const d = await fetchDaily(t, { range: "10y" }); prices[t] = d.rows; names[t] = d.name; } catch { prices[t] = null; }
  await sleep(120);
}
let unpriced = 0, unmapped = 0;
const mismatched = new Set();
for (const e of events) {
  e.fwd = e.fwdEw = null;
  if (!e.ticker) { unmapped++; continue; }
  const rows = prices[e.ticker];
  if (!rows?.length) { unpriced++; continue; }
  if (!sameCompany(e.name, names[e.ticker], e.ticker)) { mismatched.add(`${e.ticker}: ${e.name} vs ${names[e.ticker]}`); continue; }
  e.fwd = forward(e, rows, bench);
  e.fwdEw = forward(e, rows, benchEw);
}

const result = {
  run: new Date().toISOString(), years, cutoff, loaded, problems,
  events: events.length, unmapped, unpriced, tickers: tickers.length,
  missing: [...new Set(events.filter((e) => e.ticker && !prices[e.ticker]).map((e) => e.ticker))],
  mismatched: [...mismatched],
  vsSP500: analyse(events, "fwd"),
  vsEqualWeight: analyse(events, "fwdEw"),
  buys: events.filter((e) => (e.change === "new" || e.change === "added") && e.fwd)
    .map((e) => ({ m: e.manager, t: e.ticker, c: e.change, w: e.weight, filed: e.filed, m3: e.fwd.m3?.excess ?? null, m12: e.fwd.m12?.excess ?? null, m12ew: e.fwdEw?.m12?.excess ?? null })),
};
await writeFile(outFile, JSON.stringify(result, null, 1) + "\n");
const { buys, loaded: _l, ...head } = result;
console.log(JSON.stringify(head, null, 1));
