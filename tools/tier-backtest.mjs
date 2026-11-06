// Research: backtest the dip-reserve buy tiers (src/tierBacktest.js).
//   node tools/tier-backtest.mjs   -> prints JSON summary
// Data: S&P 500 price (^GSPC, daily since 1928) for the drawdown signal, S&P
// 500 total return (^SP500TR, since 1988) for wealth, 13-week T-bill yield
// (^IRX, since 1960) for cash, VIX (since 1990) and CNN Fear & Greed (our
// history, since 2020) for confirmation; FTSE 100 (^FTSE) for tier events.
import { readFile } from "node:fs/promises";
import { parseYahoo } from "../src/data/prices.js";
import { fetchJson } from "../src/data/http.js";
import { tierEvents, rollingCompare, align, volProxy } from "../src/tierBacktest.js";

const daily = async (sym) => {
  const now = Math.floor(Date.now() / 1000);
  const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=-1325635200&period2=${now}&interval=1d`, { tries: 2 });
  const { rows } = parseYahoo(j.chart.result[0]);
  if (rows.length < 2000) throw new Error(`only ${rows.length} daily bars for ${sym}`);
  console.error(`${sym}: ${rows.length} bars from ${rows[0].date}`);
  return rows;
};

const out = { notes: [] };
const [sp, tr, irx, vix, ftse] = await Promise.all(["^GSPC", "^SP500TR", "^IRX", "^VIX", "^FTSE"].map((s) => daily(s).catch((e) => { out.notes.push(`${s}: ${e.message}`); return null; })));
let fg = {};
try { fg = JSON.parse(await readFile("history/fear-greed.json", "utf8")); } catch { out.notes.push("no F&G history"); }

const VARIANTS = {
  agreed: { reserve: 0.15, levels: [-10, -20, -30] },
  tiers10_15_30: { reserve: 0.15, levels: [-10, -15, -30] },
  noConfirm: { reserve: 0.15, levels: [-10, -20, -30], confirm: false },
  noSweep: { reserve: 0.15, levels: [-10, -20, -30], sweepAfter: 0 },
  reserve10: { reserve: 0.10, levels: [-10, -20, -30] },
  reserve5: { reserve: 0.05, levels: [-10, -20, -30] },
  drip6m: { reserve: 0.15, levels: [-10, -20, -30], sweepAfter: 21, sweepFrac: 1 / 6 },
  shallow5_10_15: { reserve: 0.15, levels: [-5, -10, -15], confirm: false },
};

if (sp) {
  // Tier events on the full price history (pre-1990 confirmation by realised-vol proxy).
  const all = volProxy(align(sp, { vix, fg }));
  out.events = { sp500_1928: tierEvents(all), sp500_1990: tierEvents(all.filter((r) => r.date >= "1989-01-01")) };
  if (ftse) out.events.ftse100_1985 = tierEvents(volProxy(align(ftse, { vix, fg })));

  if (tr && irx) {
    const a = align(sp, { tr, cash: irx, vix, fg }).filter((r) => r.date >= "1988-01-04" && r.tr != null);
    out.sim_1988_total_return = { from: a[0].date, to: a.at(-1).date, y10: rollingCompare(a, VARIANTS, { years: 10 }), y5: rollingCompare(a, VARIANTS, { years: 5 }) };
  }
  if (irx) {
    // Longer sample on the price index only (dividends left out, which flatters cash).
    const b = volProxy(align(sp, { cash: irx, vix, fg }).filter((r) => r.date >= "1960-01-04"));
    out.sim_1960_price_only = { from: b[0].date, to: b.at(-1).date, y10: rollingCompare(b, VARIANTS, { years: 10 }), y20: rollingCompare(b, VARIANTS, { years: 20, step: 3 }) };
  }
}
console.log(JSON.stringify(out, null, 1));
