// Swing lab round 3: sector rotation by momentum (src/sectorRotation.js).
//   node tools/sector-rotation.mjs   -> prints JSON summary
// Total-return month ends from Yahoo's adjusted closes (dividends included).
import { fetchJson } from "../src/data/http.js";
import { dateIn } from "../src/util.js";
import { SECTORS, monthEndCloses, align, rotate, compare, stats, latest } from "../src/sectorRotation.js";

async function adjusted(sym) {
  const now = Math.floor(Date.now() / 1000);
  const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=0&period2=${now}&interval=1d&events=div,split`, { tries: 2 });
  const res = j.chart.result[0], adj = res.indicators?.adjclose?.[0]?.adjclose || [], tz = res.meta?.exchangeTimezoneName || "America/New_York";
  const bars = res.timestamp.map((ts, i) => ({ date: dateIn(tz, new Date(ts * 1000)), close: adj[i] })).filter((b) => Number.isFinite(b.close));
  console.error(`${sym}: ${bars.length} bars from ${bars[0]?.date}`);
  return monthEndCloses(bars);
}

const thisMonth = new Date().toISOString().slice(0, 7);
const series = {};
for (const s of SECTORS) series[s] = (await adjusted(s)).filter((x) => x.month < thisMonth);
const spy = (await adjusted("SPY")).filter((x) => x.month < thisMonth);
const data = align(series);
const eq = rotate(data, { lookback: 3, top: SECTORS.length });
const start = "1999-12"; // first month every variant (incl. 12-1 and the trend filter) can trade
const run = (o) => rotate(data, { start, ...o });
const bench = run({ lookback: 12, skip: 0, top: SECTORS.length });
const spyR = [];
for (let i = 1; i < spy.length; i++) spyR.push({ month: spy[i].month, r: spy[i].close / spy[i - 1].close - 1, turnover: 0 });
const variants = [
  ["primary", "Top 3 by 3-month return (primary)", { lookback: 3, top: 3 }],
  ["m1", "Top 3 by 1-month return", { lookback: 1, top: 3 }],
  ["m6", "Top 3 by 6-month return", { lookback: 6, top: 3 }],
  ["m12", "Top 3 by 12-month return", { lookback: 12, top: 3 }],
  ["m12_1", "Top 3 by 12-1 month return", { lookback: 11, skip: 1, top: 3 }],
  ["trend", "Primary with a 10-month trend filter (cash at 0%)", { lookback: 3, top: 3, trend: true }],
  ["eqTrend", "All nine with the trend filter", { lookback: 3, top: 9, trend: true }],
];
const results = variants.map(([key, label, o]) => { const r = run(o); return { key, label, ...compare(r, bench), curve: r.map((x) => x.r) }; });
const curve = (rs) => { let v = 1; return rs.map((x) => (v *= 1 + x.r)).map((x) => Math.round(x * 1000) / 1000); };
const primary = results[0];
const pr = run({ lookback: 3, top: 3 });
console.log(JSON.stringify({
  ran: new Date().toISOString().slice(0, 10), from: bench[0].month, to: bench.at(-1).month, sectors: SECTORS,
  bench: stats(bench), spy: stats(spyR.filter((x) => x.month >= bench[0].month && x.month <= bench.at(-1).month)),
  results: results.map(({ curve, ...r }) => r),
  curves: { months: bench.map((x) => x.month), primary: curve(pr), equal: curve(bench), spy: curve(spyR.filter((x) => x.month >= bench[0].month && x.month <= bench.at(-1).month)) },
  latest: latest(data, { lookback: 3, top: 3 }), lastHeld: pr.at(-1)?.held, eqCheck: stats(eq),
}, null, 1));
