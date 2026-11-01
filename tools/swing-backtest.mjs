// One-off research: replay the swing rules over the past year for every
// S&P 500 and FTSE 100 company, using the same scoring as the nightly scan.
// Each clean "Setup" becomes a paper trade (entry next open, 2x ATR stop,
// 2R target, 20-session exit), one open trade per stock at a time.
// Earnings dates aren't known historically, so setups near results are
// included (the live rule skips them): treat the result as slightly
// optimistic on avoided gaps and slightly pessimistic on sample size.
//   node tools/swing-backtest.mjs [limit]   -> prints JSON summary
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { technicals, swingSignals, swingVerdict } from "../src/research.js";
import { addSetups, updateTrade, summarise } from "../src/paperTrades.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
let universe = Object.entries(cons.indices).flatMap(([idx, xs]) => xs.map((x) => ({ ...x, market: idx === "FTSE100" ? "UK" : "US" })));
if (process.argv[2]) universe = universe.slice(0, +process.argv[2]);

const all = [], base = [];
let done = 0;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range: "2y" });
    if (rows.length < 300) continue;
    let cur = null, b = null;
    const start = Math.max(252, rows.length - 250);
    for (let d = start; d < rows.length - 1; d++) {
      const hist = rows.slice(0, d + 1);
      // Baseline: same exits, but enter on any day with no trade open.
      if (b) { b = updateTrade(b, hist); if (b.status === "closed" || b.status === "void") { base.push(b); b = null; } }
      if (cur) { cur = updateTrade(cur, hist); if (cur.status === "closed" || cur.status === "void") { all.push(cur); cur = null; } }
      const t = technicals(hist);
      const v = swingVerdict(t, swingSignals(t), null);
      if (!b && v?.stop) [b] = addSetups([], [{ symbol: u.symbol, market: u.market, price: t.last, stop: v.stop }], rows[d].date);
      if (cur) continue;
      if (v?.verdict !== "Setup") continue;
      [cur] = addSetups([], [{ symbol: u.symbol, ticker: u.ticker, name: u.name, market: u.market, price: t.last, stop: v.stop, score: v.score }], rows[d].date);
    }
    if (cur) { cur = updateTrade(cur, rows); all.push(cur); }
  } catch { /* skip */ }
  if (++done % 100 === 0) console.error(`${done}/${universe.length}`);
  await sleep(100);
}

const s = summarise(all);
const closed = all.filter((t) => t.status === "closed");
const byScore = {};
for (const t of closed) { const k = t.score >= 75 ? "75+" : t.score >= 70 ? "70-74" : "65-69"; (byScore[k] ||= []).push(t.r); }
const avg = (xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
const months = {};
for (const t of closed) { const m = t.exitDate.slice(0, 7); (months[m] ||= []).push(t.r); }
console.log(JSON.stringify({
  universe: universe.length, from: all.map((t) => t.signalDate).sort()[0], to: all.map((t) => t.signalDate).sort().at(-1),
  summary: s, baseline: summarise(base),
  avgSessions: avg(closed.map((t) => t.sessions)),
  byScore: Object.fromEntries(Object.entries(byScore).map(([k, xs]) => [k, { n: xs.length, avgR: avg(xs), winRate: Math.round((xs.filter((x) => x > 0).length / xs.length) * 100) }])),
  byMonth: Object.fromEntries(Object.entries(months).sort().map(([k, xs]) => [k, { n: xs.length, avgR: avg(xs) }])),
}, null, 1));
