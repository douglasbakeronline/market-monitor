// Index scanner: scores every S&P 500, FTSE 100 and Euro Stoxx 50 company, plus the
// Nasdaq 100 names those miss, each weeknight.
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
import { technicals, swingSignals, swingVerdict, longTerm, longTermLive, ruleChangeNote, SCORING_VERSION, daysUntil, earningsFields, resultsEstimate, summarise, sessionsBehind, STALE_SESSIONS, notScored } from "./src/research.js";
import { sectorMedians, regionMedians, peerFor, sectorValueNote } from "./src/sectorValue.js";
import { readJson, writeJson } from "./src/state.js";
import { addSetups, updateTrade, summarise as summarisePaper } from "./src/paperTrades.js";
import { r1, r2, sleep, dateIn, partsIn } from "./src/util.js";
import { recordResults } from "./src/stockHistory.js";
import { smartFor } from "./src/smartMoney.js";
import { coreExtras, coreExtraDates } from "./src/plan.js";

const DEEP_LONG = 70, DEEP_SWING = 40;
const INDEX_LABEL = { SP500: "S&P 500", FTSE100: "FTSE 100", EUROSTOXX50: "Euro Stoxx 50", NASDAQ100: "Nasdaq 100" };
const MARKET = { SP500: "US", FTSE100: "UK", EUROSTOXX50: "EU", NASDAQ100: "US" };

async function main() {
  const t0 = Date.now();
  const today = dateIn("Europe/London");
  const cons = await fetchConstituents();
  let universe = [];
  const seen = new Set();
  const seenName = new Set();
  for (const [index, list] of Object.entries(cons.indices)) for (const c of list) {
    // One line per company: drop extra share classes (GOOG/GOOGL, FOX/FOXA...).
    const base = c.name.replace(/\s*\(?class [a-z]\)?/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (seen.has(c.symbol) || seenName.has(base)) continue;
    seen.add(c.symbol); seenName.add(base);
    universe.push({ ...c, index });
  }
  if (process.env.SCAN_LIMIT) universe = universe.slice(0, +process.env.SCAN_LIMIT);
  console.log(`Scanning ${universe.length} companies (${Object.entries(cons.indices).map(([k, v]) => `${k} ${v.length}`).join(", ")})`);

  const quotes = await fetchQuotes(universe.map((u) => u.symbol));
  console.log(`Quotes: ${Object.keys(quotes).length}`);

  // Stage 1
  const items = [], failed = [], rowsBySymbol = {};
  for (const u of universe) {
    try {
      const prices = await fetchDaily(u.symbol, { range: "1y" });
      rowsBySymbol[u.symbol] = prices.rows;
      const t = technicals(prices.rows);
      if (!t) throw new Error("not enough history");
      const f = quoteToFundamentals(quotes[u.symbol]) || {};
      f.sector = u.sector;
      f.closedEnd = u.sector === "Closed End Investments";
      const earningsDays = daysUntil(f.nextEarnings, today);
      const signals = swingSignals(t);
      items.push({ u, t, f, signals, earningsDays, lt: longTermLive(f, t), swing: swingVerdict(t, signals, earningsDays), deep: false });
    } catch (e) { failed.push(u.symbol); }
    await sleep(120);
  }
  // Drop stocks that have stopped trading: their last bar is days behind the market's.
  const latest = {};
  for (const it of items) if (!latest[it.u.index] || it.t.date > latest[it.u.index]) latest[it.u.index] = it.t.date;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i], behind = sessionsBehind(it.t.date, latest[it.u.index]);
    if (behind >= STALE_SESSIONS) { console.log(`Stale: ${it.u.symbol} last traded ${it.t.date} (${behind} sessions behind), dropped.`); failed.push(it.u.symbol); items.splice(i, 1); }
  }
  console.log(`Stage 1: ${items.length} scored, ${failed.length} failed (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

  // Value against sector peers (live since 10 Nov): medians from the quick data
  // pick the stage 2 candidates; they are recomputed after stage 2 below.
  const peerOf = (it, med, reg) => peerFor({ ...it.f, sector: it.u.sector || it.f.sector }, med, reg, MARKET[it.u.index] ?? "US");
  const peerRowsOf = () => items.map((it) => ({ sector: it.u.sector || it.f.sector, market: MARKET[it.u.index] ?? "US", forwardPE: it.f.forwardPE, trailingPE: it.f.trailingPE, evToEbitda: it.f.evToEbitda, trust: notScored(it.f) }));
  { const rows = peerRowsOf(), m1 = sectorMedians(rows), r1m = regionMedians(rows); for (const it of items) { it.peer = peerOf(it, m1, r1m); it.lt = longTermLive(it.f, it.t, it.peer); } }

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
      it.lt = longTermLive(it.f, it.t, it.peer);
      it.swing = swingVerdict(it.t, it.signals, it.earningsDays);
      it.deep = true;
    }
    await sleep(300);
  }
  console.log(`Stage 2: ${deep.filter((d) => d.deep).length} deepened (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

  // Final scores with medians that include the deepened data. The old rule
  // (before 10 Nov) is kept only for the "what changed" note.
  const peerRows = peerRowsOf();
  const medians = sectorMedians(peerRows), regional = regionMedians(peerRows);
  for (const it of items) {
    const peer = peerOf(it, medians, regional);
    it.lt = longTermLive(it.f, it.t, peer);
    const old = longTerm(it.f, it.t);
    it.sv = peer ? sectorValueNote(it.f, peer, old, it.lt) : null;
    it.rc = ruleChangeNote(old, it.lt);
  }

  // Results dates seen so far, so estimates learn each company's reporting gap.
  const resultsHist = await readJson("history/results-dates.json", {});
  for (const it of items) recordResults(resultsHist, it.u.symbol, [it.f.lastEarnings, it.f.nextEarnings], today);

  // Smart money (display only): 13F holdings of a few long-term managers,
  // refreshed weekly by tools/smart-money.mjs in this workflow.
  const smart = await readJson("data/smart-money.json", null);

  const out = items.map(({ u, t, f, signals, earningsDays, lt, swing, deep: isDeep, sv, rc }) => {
    const item = {
      symbol: u.symbol, ticker: u.symbol.replace(/\.L$/, ""), index: INDEX_LABEL[u.index], market: MARKET[u.index] ?? "US",
      name: f.name || u.name, sector: u.sector || f.sector, industry: f.industry ?? null, currency: f.currency ?? null,
      pe: r1(f.forwardPE > 0 ? f.forwardPE : f.trailingPE > 0 ? f.trailingPE : null), price: r2(t.last), date: t.date, marketCap: f.marketCap ?? null, dividendYield: f.dividendYield ?? null, beta: r2(f.beta),
      perf: { day: r1(t.dayPct), week: r1(t.weekPct), month: r1(t.monthPct), m3: r1(t.m3Pct), y1: r1(t.y1Pct), mom12_1: r1(t.mom12_1) },
      tech: { rsi: r1(t.rsi), vs50: r1(t.vs50), vs200: r1(t.vs200), offHigh: r1(t.offHigh), high52: r2(t.high52), low52: r2(t.low52), atrPct: r1(t.atrPct), volRatio: r2(t.volRatio) },
      target: f.targetMean ? { mean: r2(f.targetMean), high: r2(f.targetHigh), low: r2(f.targetLow), analysts: f.analysts, rec: r2(f.recommendationMean), recKey: f.recommendationKey } : null,
      ...earningsFields(f.nextEarnings, f.lastEarnings, today),
      longTerm: isDeep ? lt : { score: lt.score, verdict: lt.verdict, note: lt.note, coverage: lt.coverage, pillars: lt.pillars.map((p) => ({ key: p.key, label: p.label, score: p.score, items: [] })) },
      swing, signals, deep: isDeep, sectorValue: sv, ruleChange: rc,
      // Rank: missing quality data (e.g. investment trusts) shouldn't float to the top.
      rank: lt.score == null ? null : Math.round(lt.score * (lt.pillars.find((p) => p.key === "quality")?.score == null && isDeep ? 0.85 : 1)),
      series: isDeep ? t.series : [],
    };
    const sm = smartFor(u.symbol, smart);
    if (sm) item.smartMoney = sm;
    if (!item.earnings) item.resultsEstimate = resultsEstimate(item.lastEarnings, today, { uk: item.market !== "US", history: resultsHist[u.symbol] || [] });
    item.summary = summarise(item);
    return item;
  }).sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1));

  // What's new since the previous scan (full-score good entries and setups).
  const prev = await readJson("scan.json", null);
  const prevGood = new Set(prev?.items?.filter((i) => i.deep && i.longTerm.verdict === "Good entry").map((i) => i.symbol) ?? []);
  const prevSetup = new Set(prev?.items?.filter((i) => i.swing?.verdict?.startsWith("Setup")).map((i) => i.symbol) ?? []);
  // A scoring rule change re-baselines "new" rather than listing every verdict it moved.
  const hasPrev = !!prev?.items?.length && prev.scoringVersion === SCORING_VERSION;
  const newGood = hasPrev ? out.filter((i) => i.deep && i.longTerm.verdict === "Good entry" && !prevGood.has(i.symbol)).map((i) => i.symbol) : [];
  const newSetups = hasPrev ? out.filter((i) => i.swing?.verdict?.startsWith("Setup") && !prevSetup.has(i.symbol)).map((i) => i.symbol) : [];

  // Swing paper trades: score open ones, then log tonight's clean setups.
  // Only after both markets have closed, so no trade is judged on a part-day bar.
  const paperLog = await readJson("history/paper-trades.json", []);
  let paper = paperLog;
  if (marketsClosed()) {
    paper = paperLog.map((t) => updateTrade(t, rowsBySymbol[t.symbol]));
    // Euro Stoxx names are scored but not paper-traded: the swing backtests and
    // cost model cover US and UK only.
    const setups = out.filter((i) => i.swing?.verdict === "Setup" && i.market !== "EU").map((i) => ({ symbol: i.symbol, ticker: i.ticker, name: i.name, market: i.market,
      currency: i.currency, price: i.price, stop: i.swing.stop, score: i.swing.score, date: i.date }));
    for (const [date, group] of Object.entries(Object.groupBy(setups, (x) => x.date))) paper = addSetups(paper, group, date);
  } else console.log("Paper trades: markets open, not updated.");
  await writeJson("history/paper-trades.json", paper, true);
  await writeJson("history/results-dates.json", resultsHist);
  const paperSummary = summarisePaper(paper);
  console.log(`Paper trades: ${paperSummary.open} open, ${paperSummary.closed} closed${paperSummary.avgR != null ? `, ${paperSummary.avgR}R average` : ""}.`);

  // Results dates of big core-fund holdings the indices miss (TSMC, Samsung,
  // SK hynix) for the Dashboard's Key dates. Never stops the scan.
  let coreDates = [];
  try {
    const eq = await fetchQuotes(coreExtras().map((h) => h.symbol));
    coreDates = coreExtraDates(eq, quoteToFundamentals, earningsFields, today);
    console.log(`Core extras: ${coreDates.map((d) => `${d.symbol} ${d.earnings?.date ?? `last ${d.lastEarnings ?? "?"}`}`).join(", ") || "none"}`);
  } catch (e) { console.warn(`Core extras failed: ${e.message}`); coreDates = prev?.coreExtras ?? []; }

  await writeJson("scan.json", {
    updated: new Date().toISOString(), minutes: r1((Date.now() - t0) / 60000),
    universe: universe.length, scored: out.length, deepened: out.filter((i) => i.deep).length, failed,
    counts: Object.fromEntries(Object.entries(cons.indices).map(([k, v]) => [INDEX_LABEL[k], v.length])),
    newGood, newSetups, paper: paperSummary, sectorMedians: medians, sectorMediansByRegion: regional, scoringVersion: SCORING_VERSION, ruleChanges: ruleChanges(out), coreExtras: coreDates, items: out,
  });
  const rcs = ruleChanges(out);
  console.log(`Scoring (live since 10 Nov): ${rcs.changed} of ${rcs.compared} full-score verdicts differ from the old rule; Good entry lost: ${rcs.lostGood.join(", ") || "none"}; gained: ${rcs.gainedGood.join(", ") || "none"}.`);
  console.log(`Done: ${out.length} scored, ${newGood.length} new good entries, ${newSetups.length} new setups, ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
}

// Full-score verdicts the 10 Nov scoring change moved, against the old rule.
function ruleChanges(out) {
  const deep = out.filter((i) => i.deep && i.longTerm?.score != null && !i.longTerm.trust);
  const changed = deep.filter((i) => i.ruleChange);
  return { compared: deep.length, changed: changed.length,
    lostGood: changed.filter((i) => i.ruleChange.verdict === "Good entry").map((i) => i.symbol),
    gainedGood: changed.filter((i) => i.longTerm.verdict === "Good entry").map((i) => i.symbol) };
}

// True when neither London nor New York is in its trading session.
function marketsClosed(at = new Date()) {
  const ny = partsIn("America/New_York", at), lon = partsIn("Europe/London", at);
  const weekend = (p) => p.weekday === 0 || p.weekday === 6;
  const nyOpen = !weekend(ny) && ny.min >= 9 * 60 + 30 && ny.min < 16 * 60 + 15;
  const lonOpen = !weekend(lon) && lon.min >= 8 * 60 && lon.min < 16 * 60 + 45;
  return !nyOpen && !lonOpen;
}

main().catch((e) => { console.error("Scan failed:", e); process.exit(1); });
