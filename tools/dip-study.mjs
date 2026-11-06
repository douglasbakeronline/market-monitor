// Research: forward returns after big one-day falls and 5% pullbacks in the
// S&P 500 and FTSE 100, and the cost or gain of buying at the pullback trigger
// instead of 1 to 4 weeks later (src/dipStudy.js).
//   node tools/dip-study.mjs   -> prints JSON summary
import { fetchDaily } from "../src/data/prices.js";
import { analyseIndex } from "../src/dipStudy.js";

const out = {};
for (const [key, sym] of [["sp500", "^GSPC"], ["ftse100", "^FTSE"]]) {
  try {
    const { rows } = await fetchDaily(sym, { range: "max" });
    out[key] = analyseIndex(rows);
  } catch (e) { out[key] = { error: String(e?.message || e) }; }
}
console.log(JSON.stringify(out, null, 1));
