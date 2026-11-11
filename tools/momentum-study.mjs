// Swing lab round 5: stock momentum (src/momentum.js), pre-registered.
//   node tools/momentum-study.mjs [limit]   -> prints JSON summary
// Total-return month ends from Yahoo's adjusted closes, 20 years.
import { readFile } from "node:fs/promises";
import { fetchJson } from "../src/data/http.js";
import { dateIn, sleep } from "../src/util.js";
import { monthEndCloses } from "../src/sectorRotation.js";
import { onMonths, studyMarket, momVerdict, momentumNow, monthly, cleanSpikes, MOM_SPLIT } from "../src/momentum.js";
import { stats, compare } from "../src/sectorRotation.js";

const YEARS = 20;
async function adjusted(sym) {
  const now = Math.floor(Date.now() / 1000), p1 = now - Math.round(YEARS * 365.25 * 86400);
  const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${now}&interval=1d&events=div,split`, { tries: 2 });
  const res = j.chart.result[0], adj = res.indicators?.adjclose?.[0]?.adjclose || [], tz = res.meta?.exchangeTimezoneName || "America/New_York";
  const bars = res.timestamp.map((ts, i) => ({ date: dateIn(tz, new Date(ts * 1000)), close: adj[i] })).filter((b) => Number.isFinite(b.close) && b.close > 0);
  return cleanSpikes(monthEndCloses(bars));
}

const thisMonth = new Date().toISOString().slice(0, 7);
const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
const limit = +process.argv[2] || Infinity;
const markets = [["US", "SP500", "^GSPC"], ["UK", "FTSE100", "^FTSE"]];
const out = [], now = {};
let fetched = 0, failed = 0;
for (const [market, key, idxSym] of markets) {
  const idx = (await adjusted(idxSym)).filter((x) => x.month < thisMonth);
  const months = idx.map((x) => x.month);
  const series = {};
  for (const u of cons.indices[key].slice(0, limit)) {
    try { const xs = (await adjusted(u.symbol)).filter((x) => x.month < thisMonth); if (xs.length >= 14) { series[u.symbol] = xs; fetched++; } }
    catch { failed++; }
    await sleep(80);
  }
  console.error(`${market}: ${Object.keys(series).length} series, ${months[0]} to ${months.at(-1)}`);
  const closes = onMonths(series, months), index = idx.map((x) => x.close);
  const start = months[13];
  out.push(studyMarket(months, closes, index, market, { start }));
  const n = momentumNow(months, closes, index);
  now[market] = { ...n, top: n.top.map((x) => ({ ...x, ticker: cons.indices[key].find((c) => c.symbol === x.s)?.ticker ?? x.s })) };
}
// Reality check: a real momentum fund (no survivorship) vs the market.
let reality = null;
try {
  const m = (await adjusted("MTUM")).filter((x) => x.month < thisMonth), s = (await adjusted("SPY")).filter((x) => x.month < thisMonth);
  const first = m[1]?.month; // first full month
  const mr = monthly(m).filter((x) => x.month > first), sr = monthly(s).filter((x) => x.month > first);
  const c = compare(mr, sr, { split: MOM_SPLIT });
  reality = { fund: "MTUM", bench: "SPY", from: mr[0]?.month, to: mr.at(-1)?.month, mtum: stats(mr), spy: stats(sr), excess: c.excess, rollShare: c.rollShare, halves: c.halves };
} catch (e) { console.error(`MTUM check failed: ${e.message}`); }
console.log(JSON.stringify({ ran: new Date().toISOString().slice(0, 10), fetched, failed, split: MOM_SPLIT, markets: out, verdict: momVerdict(out), reality, now }, null, 1));
