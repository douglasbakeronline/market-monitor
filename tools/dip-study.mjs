// Research: forward returns after big one-day falls and 5% pullbacks in the
// S&P 500 and FTSE 100, and the cost or gain of buying at the pullback trigger
// instead of 1 to 4 weeks later (src/dipStudy.js).
//   node tools/dip-study.mjs   -> prints JSON summary
import { parseYahoo } from "../src/data/prices.js";
import { fetchJson } from "../src/data/http.js";
import { analyseIndex } from "../src/dipStudy.js";

const out = {};
for (const [key, sym] of [["sp500", "^GSPC"], ["ftse100", "^FTSE"]]) {
  try {
    // range=max downgrades to monthly bars, so ask for daily bars by period.
    const now = Math.floor(Date.now() / 1000);
    const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=-1325635200&period2=${now}&interval=1d`, { tries: 2 });
    const { rows } = parseYahoo(j.chart.result[0]);
    if (rows.length < 2000) throw new Error(`only ${rows.length} daily bars for ${sym}`);
    out[key] = analyseIndex(rows);
  } catch (e) { out[key] = { error: String(e?.message || e) }; }
}
console.log(JSON.stringify(out, null, 1));
