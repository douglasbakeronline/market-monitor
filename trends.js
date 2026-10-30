// Trends: themes (AI, semis, software, infrastructure...), momentum leaders and
// a sector heatmap. Writes trends.json for the Trends page. Runs after the scan.
//   node trends.js        DRY_RUN=1 node trends.js
import { THEMES, BENCHMARK } from "./src/themes.js";
import { fetchDaily } from "./src/data/prices.js";
import { technicals } from "./src/research.js";
import { readJson, writeJson } from "./src/state.js";
import { r1, r2, sleep, median, pct } from "./src/util.js";

const cache = new Map();
async function load(sym) {
  if (cache.has(sym)) return cache.get(sym);
  let out = null;
  try {
    const d = await fetchDaily(sym, { range: "2y" });
    const t = technicals(d.rows);
    if (t) {
      const y = d.rows.at(-1).date.slice(0, 4);
      const prev = [...d.rows].reverse().find((r) => r.date.slice(0, 4) < y);
      out = { symbol: sym, ticker: sym.replace(/\.L$/, ""), name: d.name || sym, currency: d.currency, price: r2(t.last), date: t.date,
        day: r1(t.dayPct), week: r1(t.weekPct), month: r1(t.monthPct), m3: r1(t.m3Pct), y1: r1(t.y1Pct), ytd: prev ? r1(pct(t.last, prev.close)) : null,
        vs50: r1(t.vs50), vs200: r1(t.vs200), rsi: r1(t.rsi), offHigh: r1(t.offHigh), volRatio: r2(t.volRatio),
        newHigh: !!t.breakout, trend: t.sma50 && t.sma200 ? (t.last > t.sma50 && t.sma50 > t.sma200 ? "up" : t.last < t.sma50 && t.sma50 < t.sma200 ? "down" : "mixed") : null,
        series: t.series.slice(-60) };
    }
  } catch (e) { console.warn(`Trends: ${sym} failed (${e.message})`); }
  await sleep(250);
  cache.set(sym, out);
  return out;
}

async function main() {
  const t0 = Date.now();
  const bench = await load(BENCHMARK);
  const themes = [];
  for (const th of THEMES) {
    const etf = th.etf ? await load(th.etf) : null;
    const stocks = [];
    for (const s of th.stocks) { const x = await load(s); if (x) stocks.push({ ...x, rs3m: bench?.m3 != null && x.m3 != null ? r1(x.m3 - bench.m3) : null }); }
    stocks.sort((a, b) => (b.m3 ?? -999) - (a.m3 ?? -999));
    const med = (k) => r1(median(stocks.map((s) => s[k])));
    themes.push({ key: th.key, name: th.name, note: th.note, etf, stocks,
      summary: { day: med("day"), week: med("week"), month: med("month"), m3: med("m3"), ytd: med("ytd"), y1: med("y1"),
        uptrend: stocks.filter((s) => s.trend === "up").length, count: stocks.length, newHighs: stocks.filter((s) => s.newHigh).length,
        rs3m: bench?.m3 != null && med("m3") != null ? r1(med("m3") - bench.m3) : null } });
  }
  themes.sort((a, b) => (b.summary.m3 ?? -999) - (a.summary.m3 ?? -999));

  // Market-wide lists from the nightly scan (S&P 500 + FTSE 100).
  const scan = await readJson("scan.json", null);
  const items = scan?.items ?? [];
  const pick = (i) => ({ symbol: i.symbol, ticker: i.ticker, name: i.name, sector: i.sector, index: i.index, price: i.price, currency: i.currency,
    day: i.perf?.day, month: i.perf?.month, m3: i.perf?.m3, y1: i.perf?.y1, rsi: i.tech?.rsi, offHigh: i.tech?.offHigh, volRatio: i.tech?.volRatio,
    lt: i.longTerm?.score, ltVerdict: i.longTerm?.verdict, sw: i.swing?.score, swVerdict: i.swing?.verdict });
  const top = (arr, k, n = 12, dir = -1) => arr.filter((i) => i.perf?.[k] != null).sort((a, b) => dir * (a.perf[k] - b.perf[k])).slice(0, n).map(pick);
  const leaders = {
    momentum: top(items, "m3"),
    gainersToday: top(items, "day", 8),
    losersToday: top(items, "day", 8, 1),
    newHighs: items.filter((i) => i.signals?.some((s) => s.key === "breakout")).sort((a, b) => (b.perf?.m3 ?? 0) - (a.perf?.m3 ?? 0)).slice(0, 12).map(pick),
    volume: items.filter((i) => (i.tech?.volRatio ?? 0) >= 2).sort((a, b) => b.tech.volRatio - a.tech.volRatio).slice(0, 10).map(pick),
  };

  // Sector heatmap (S&P 500 only, GICS sectors).
  const bySector = {};
  for (const i of items.filter((x) => x.index === "S&P 500" && x.sector)) (bySector[i.sector] ||= []).push(i);
  const sectors = Object.entries(bySector).map(([name, xs]) => ({ name, count: xs.length,
    day: r1(median(xs.map((x) => x.perf?.day))), week: r1(median(xs.map((x) => x.perf?.week))), month: r1(median(xs.map((x) => x.perf?.month))),
    m3: r1(median(xs.map((x) => x.perf?.m3))), ytd: null,
    above200: Math.round((xs.filter((x) => (x.tech?.vs200 ?? -1) > 0).length / xs.length) * 100) })).sort((a, b) => (b.m3 ?? 0) - (a.m3 ?? 0));

  await writeJson("trends.json", { updated: new Date().toISOString(), benchmark: bench, themes, leaders, sectors, scanUpdated: scan?.updated ?? null });
  console.log(`Trends: ${themes.length} themes, ${cache.size} symbols, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
main().catch((e) => { console.error("Trends failed:", e); process.exit(1); });
