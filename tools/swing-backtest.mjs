// Research: replay the swing rules over past years for every S&P 500 and
// FTSE 100 company, using the same scoring as the nightly scan. Each clean
// "Setup" becomes a paper trade (entry next open, 2x ATR stop, 2R target,
// 20-session exit), one open trade per stock at a time. A random-entry
// baseline (any day, same exits) runs alongside. Trades are tagged with what
// was known at the signal (score, market, uptrend, results nearby) so the
// retune variants in src/swingRetune.js can be compared after costs.
// Results dates aren't known historically; they are projected quarterly from
// known dates (US only, approximate).
//   node tools/swing-backtest.mjs [limit] [range]   -> prints JSON summary
//   range defaults to 5y (about four years of trades after a year's warm-up)
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { technicals, swingSignals, swingVerdict } from "../src/research.js";
import { addSetups, updateTrade, summarise } from "../src/paperTrades.js";
import { analyse, resultsNear } from "../src/swingRetune.js";
import { sleep } from "../src/util.js";

const cons = JSON.parse(await readFile("data/constituents.json", "utf8"));
let universe = Object.entries(cons.indices).flatMap(([idx, xs]) => xs.map((x) => ({ ...x, market: idx === "FTSE100" ? "UK" : "US" })));
if (process.argv[2] && +process.argv[2] > 0) universe = universe.slice(0, +process.argv[2]);
const range = process.argv[3] || "5y";

// Known results dates per symbol, to anchor the quarterly projection.
const anchors = {};
const add = (s, d) => { if (s && d) (anchors[s] ||= new Set()).add(d); };
try { for (const i of JSON.parse(await readFile("scan.json", "utf8")).items) { add(i.symbol, i.earnings?.date); add(i.symbol, i.lastEarnings); } } catch { /* none */ }
try { for (const [s, ds] of Object.entries(JSON.parse(await readFile("history/earnings.json", "utf8")))) for (const d of ds) add(s, d); } catch { /* none */ }

const all = [], base = [];
let done = 0, fetched = 0;
for (const u of universe) {
  try {
    const { rows } = await fetchDaily(u.symbol, { range });
    if (rows.length < 300) continue;
    fetched++;
    const anch = u.market === "US" ? [...(anchors[u.symbol] || [])] : [];
    const tag = (t, d, ctx) => ({ ...t, uptrend: ctx.up, resultsNear: anch.length ? resultsNear(rows[d].date, anch) : false, hasAnchor: anch.length > 0 });
    let cur = null, b = null;
    for (let d = 252; d < rows.length - 1; d++) {
      const hist = rows.slice(0, d + 1);
      if (b) { b = updateTrade(b, hist); if (b.status === "closed" || b.status === "void") { base.push(b); b = null; } }
      if (cur) { cur = updateTrade(cur, hist); if (cur.status === "closed" || cur.status === "void") { all.push(cur); cur = null; } }
      if (b && cur) continue;
      const t = technicals(rows.slice(Math.max(0, d - 299), d + 1));
      const sig = swingSignals(t), v = swingVerdict(t, sig, null);
      const ctx = { up: sig.some((s) => s.key === "uptrend") };
      if (!b && v?.stop) { const [x] = addSetups([], [{ symbol: u.symbol, market: u.market, price: t.last, stop: v.stop }], rows[d].date); if (x) b = tag(x, d, ctx); }
      if (cur || v?.verdict !== "Setup") continue;
      const [x] = addSetups([], [{ symbol: u.symbol, ticker: u.ticker, name: u.name, market: u.market, price: t.last, stop: v.stop, score: v.score }], rows[d].date);
      if (x) cur = tag(x, d, ctx);
    }
  } catch { /* skip */ }
  if (++done % 100 === 0) console.error(`${done}/${universe.length}`);
  await sleep(100);
}

const closed = all.filter((t) => t.status === "closed");
const anchored = closed.filter((t) => t.market === "US" && t.hasAnchor).length;
console.log(JSON.stringify({
  universe: universe.length, fetched, range,
  from: closed.map((t) => t.signalDate).sort()[0], to: closed.map((t) => t.signalDate).sort().at(-1),
  summary: summarise(all), baseline: summarise(base),
  resultsProjection: { usTrades: closed.filter((t) => t.market === "US").length, withKnownDate: anchored, flaggedNear: closed.filter((t) => t.resultsNear).length },
  variants: analyse(all, base),
}, null, 1));
