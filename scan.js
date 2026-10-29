// Index scanner: scores every S&P 500 and FTSE 100 company each weeknight.
//   Stage 1 (all ~600): daily prices + batch quotes -> swing signals and a
//                       provisional long-term score (value, entry, analysts).
//   Stage 2 (top ~100): full fundamentals for the best candidates and every
//                       swing setup -> full long-term score with quality.
// Writes scan.json for the Research page's "Index scan" view.
//   node scan.js            DRY_RUN=1 node scan.js     SCAN_LIMIT=40 node scan.js

import { fetchConstituents } from "./src/data/constituents.js";
import { fetchQuotes, quoteToFundamentals } from "./src/data/quotes.js";
import { fetchDaily } from "./src/data/prices.js";
import { fetchFundamentals } from "./src/data/fundamentals.js";
import { technicals, swingSignals, swingVerdict, longTerm, daysUntil, summarise } from "./src/research.js";
import { readJson, writeJson } from "./src/state.js";
import { r1, r2, sleep, dateIn } from "./src/util.js";

const DEEP_LONG = 70, DEEP_SWING = 40;
const INDEX_LABEL = { SP500: "S&P 500", FTSE100: "FTSE 100" };

async function main() {
  const t0 = Date.now();
  const today = dateIn("Europe/London");
  const cons = await fetchConstituents();
  let universe = [];
  const seen = new Set();
  for (const [index, list] of Object.entries(cons.indices)) for (const c of list) {
    if (seen.has(c.symbol)) continue;
    seen.add(c.symbol);
    universe.push({ ...c, index });
  }
  if (process.env.SCAN_LIMIT) universe = universe.slice(0, +process.env.SCAN_LIMIT);
  console.log(`Scanning ${universe.length} companies (${Object.entries(cons.indices).map(([k, v]) => `${k} ${v.length}`).join(", ")})`);

  const quotes = await fetchQuotes(universe.map((u) => u.symbol));
  console.log(`Quotes: ${Object.keys(quotes).length}`);

  // Stage 1
  const items = [], failed = [];
  for (const u of universe) {
    try {
      const prices = await fetchDaily(u.symbol, { range: "1y" });
      const t = technicals(prices.rows);
      if (!t) throw new Error("not enough history");
      const f = quoteToFundamentals(quotes[u.symbol]) || {};
      f.sector = u.sector;
      const earningsDays = daysUntil(f.nextEarnings, today);
      const signals = swingSignals(t);
      items.push({ u, t, f, signals, earningsDays, lt: longTerm(f, t), swing: swingVerdict(t, signals, earningsDays), deep: false });
    } catch (e) { failed.push(u.symbol); }
    await sleep(120);
  }
  console.log(`Stage 1: ${items.length} scored, ${failed.length} failed (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

  // Stage 2: deepen the best long-term candidates and the swing setups.
  const byLong = items.filter((i) => i.lt.score != null).sort((a, b) => b.lt.score - a.lt.score).slice(0, DEEP_LONG);
  const bySwing = items.filter((i) => i.swing?.verdict?.startsWith("Setup")).sort((a, b) => b.swing.score - a.swing.score).slice(0, DEEP_SWING);
  const deep = [...new Set([...byLong, ...bySwing])];
  for (const it of deep) {
    const full = await fetchFundamentals(it.u.symbol).catch(() => null);
    if (full) {
      it.f = { ...it.f, ...Object.fromEntries(Object.entries(full).filter(([, v]) => v != null)) };
      it.f.sector = full.sector || it.u.sector;
      it.earningsDays = daysUntil(it.f.nextEarnings, today);
      it.lt = longTerm(it.f, it.t);
      it.swing = swingVerdict(it.t, it.signals, it.earningsDays);
      it.deep = true;
    }
    await sleep(300);
  }
  console.log(`Stage 2: ${deep.filter((d) => d.deep).length} deepened (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

  const out = items.map(({ u, t, f, signals, earningsDays, lt, swing, deep: isDeep }) => {
    const item = {
      symbol: u.symbol, ticker: u.symbol.replace(/\.L$/, ""), index: INDEX_LABEL[u.index], market: u.index === "FTSE100" ? "UK" : "US",
      name: f.name || u.name, sector: f.sector || u.sector, industry: f.industry ?? null, currency: f.currency ?? null,
      price: r2(t.last), date: t.date, marketCap: f.marketCap ?? null, dividendYield: f.dividendYield ?? null, beta: r2(f.beta),
      perf: { day: r1(t.dayPct), week: r1(t.weekPct), month: r1(t.monthPct), m3: r1(t.m3Pct), y1: r1(t.y1Pct) },
      tech: { rsi: r1(t.rsi), vs50: r1(t.vs50), vs200: r1(t.vs200), offHigh: r1(t.offHigh), high52: r2(t.high52), low52: r2(t.low52), atrPct: r1(t.atrPct), volRatio: r2(t.volRatio) },
      target: f.targetMean ? { mean: r2(f.targetMean), high: r2(f.targetHigh), low: r2(f.targetLow), analysts: f.analysts, rec: r2(f.recommendationMean), recKey: f.recommendationKey } : null,
      earnings: f.nextEarnings ? { date: f.nextEarnings, days: earningsDays } : null,
      longTerm: isDeep ? lt : { score: lt.score, verdict: lt.verdict, note: lt.note, coverage: lt.coverage, pillars: lt.pillars.map((p) => ({ key: p.key, label: p.label, score: p.score, items: [] })) },
      swing, signals, deep: isDeep,
      series: isDeep ? t.series : [],
    };
    item.summary = summarise(item);
    return item;
  }).sort((a, b) => (b.longTerm.score ?? -1) - (a.longTerm.score ?? -1));

  // What's new since the previous scan (full-score good entries and setups).
  const prev = await readJson("scan.json", null);
  const prevGood = new Set(prev?.items?.filter((i) => i.deep && i.longTerm.verdict === "Good entry").map((i) => i.symbol) ?? []);
  const prevSetup = new Set(prev?.items?.filter((i) => i.swing?.verdict?.startsWith("Setup")).map((i) => i.symbol) ?? []);
  const hasPrev = !!prev?.items?.length;
  const newGood = hasPrev ? out.filter((i) => i.deep && i.longTerm.verdict === "Good entry" && !prevGood.has(i.symbol)).map((i) => i.symbol) : [];
  const newSetups = hasPrev ? out.filter((i) => i.swing?.verdict?.startsWith("Setup") && !prevSetup.has(i.symbol)).map((i) => i.symbol) : [];

  await writeJson("scan.json", {
    updated: new Date().toISOString(), minutes: r1((Date.now() - t0) / 60000),
    universe: universe.length, scored: out.length, deepened: out.filter((i) => i.deep).length, failed,
    counts: Object.fromEntries(Object.entries(cons.indices).map(([k, v]) => [INDEX_LABEL[k], v.length])),
    newGood, newSetups, items: out,
  });
  console.log(`Done: ${out.length} scored, ${newGood.length} new good entries, ${newSetups.length} new setups, ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
}

main().catch((e) => { console.error("Scan failed:", e); process.exit(1); });
