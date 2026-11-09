// Research: should the pullback rule watch VWRP in pounds instead of the
// S&P 500 / FTSE 100? Replays monthly core purchases (src/coreTrigger.js).
//   node tools/core-trigger.mjs   -> prints JSON summary
import { parseYahoo } from "../src/data/prices.js";
import { fetchJson } from "../src/data/http.js";
import { ddByDate, toGbp, simulate, agreement } from "../src/coreTrigger.js";

const now = Math.floor(Date.now() / 1000);
async function daily(sym) {
  const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=946684800&period2=${now}&interval=1d`, { tries: 2 });
  const { rows } = parseYahoo(j.chart.result[0]);
  // Bad-tick guard: report one-day moves over 15% (none expected for indices or funds).
  const odd = rows.filter((r, i) => i && Math.abs(r.close / rows[i - 1].close - 1) > 0.15).map((r) => r.date);
  return { rows, odd, first: rows[0]?.date, n: rows.length };
}

const out = { meta: {} };
try {
  const [sp, ftse, vwrl, acwi, fx] = await Promise.all(["^GSPC", "^FTSE", "VWRL.L", "ACWI", "GBPUSD=X"].map(daily));
  for (const [k, v] of Object.entries({ sp, ftse, vwrl, acwi, fx })) out.meta[k] = { first: v.first, n: v.n, odd: v.odd };
  const acwiGbp = toGbp(acwi.rows, fx.rows);
  const src = { sp: ddByDate(sp.rows), ftse: ddByDate(ftse.rows) };
  for (const threshold of [-5, -7]) {
    for (const [name, asset, from] of [["vwrl", vwrl.rows, "2013-07-01"], ["acwiGbp", acwiGbp, "2009-05-01"]]) {
      const r = simulate(asset, { ...src, own: ddByDate(asset) }, { from, threshold, either: ["sp", "ftse"] });
      const months = r.sources.own.months;
      out[`${name}_${-threshold}`] = { from: r.from, to: r.to, threshold, sources: r.sources,
        agree: agreement(r.firedBy, "sp|ftse", "own", months) };
    }
  }
} catch (e) { out.error = String(e?.message || e); }
console.log(JSON.stringify(out, null, 1));
