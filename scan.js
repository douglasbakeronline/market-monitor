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
import { fetchFundamentals, fetchEvToEbitda, fetchTimeseries } from "./src/data/fundamentals.js";
import { pickRefresh, record, prune, evMedians, evPeer, freshEv, withEv } from "./src/evSample.js";
import { technicals, swingSignals, swingVerdict, longTerm, longTermLive, ruleChangeNote, SCORING_VERSION, daysUntil, earningsFields, resultsEstimate, summarise, sessionsBehind, STALE_SESSIONS, notScored } from "./src/research.js";
import { sectorMedians, regionMedians, peerFor, sectorValueNote, reitMedian, reitView } from "./src/sectorValue.js";
import { readJson, writeJson } from "./src/state.js";
import { addSetups, updateTrade, summarise as summarisePaper } from "./src/paperTrades.js";
import { driftToday, addDrift, updateDrift, summariseDrift } from "./src/swingLab.js";
import { reportDay, resultsCheck, resultsRecord, resultsMoves, reactionDays } from "./src/surpriseStudy.js";
import { fetchResultsData } from "./src/data/fundamentals.js";
import { PLAN } from "./src/plan.js";
import { r1, r2, sleep, dateIn, partsIn } from "./src/util.js";
import { recordResults } from "./src/stockHistory.js";
import { smartFor } from "./src/smartMoney.js";
import { latestSellSignals } from "./src/sellSignals.js";
import { swingBook, randomBooks, benchSeries } from "./src/swingBook.js";
import { driftBook, randomDriftBooks } from "./src/driftBook.js";
import { newPlanBook, stepPlanBook, planSummary } from "./src/planBook.js";
import { newBuffettBook, reviewDue, review, fillOrders, markBuffett } from "./src/buffettBook.js";
import { buffettQuality, buffettLens, parseTimeseries, pickBuffett, freshQ, TS_TYPES, updateLensEvents, summariseLensEvents } from "./src/buffett.js";
import { newMomentumBook, rebalanceDue, monthView, trendUp, rankMomentum, rebalance, markBook, momCost } from "./src/momentumBook.js";
import { costR } from "./src/swingRetune.js";
import { runDataChecks, dataChecksLine } from "./src/dataChecks.js";
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

  // EV/EBITDA peer sample (src/evSample.js; in the score since 11 Nov): deepened stocks
  // record theirs, and a rotating batch of the rest is refreshed each night.
  const evCache = prune(await readJson("data/ev-sample.json", {}), items.map((it) => it.u.symbol));
  for (const it of items) if (it.deep) record(evCache, it.u.symbol, it.f.evToEbitda, today);
  let evFetched = 0, evFailed = 0;
  for (const sym of pickRefresh(items.filter((it) => !it.deep && !notScored(it.f)).map((it) => it.u.symbol), evCache, today)) {
    try { record(evCache, sym, await fetchEvToEbitda(sym), today); evFetched++; } catch { evFailed++; }
    await sleep(300);
  }
  const evMed = evMedians(items.map((it) => ({ symbol: it.u.symbol, sector: it.u.sector || it.f.sector, market: MARKET[it.u.index] ?? "US", trust: notScored(it.f) })), evCache, today);
  await writeJson("data/ev-sample.json", evCache);
  console.log(`EV/EBITDA sample: ${evFetched} fetched, ${evFailed} failed, ${evMed.coverage}% of the universe fresh${evMed.ready ? "" : " (medians wait for 60%)"} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

  // Buffett lens (display and paper only, 11 Nov): four years of annual
  // accounts per company, refreshed on a rotation (src/buffett.js).
  const bCache = prune(await readJson("data/buffett-sample.json", {}), items.map((it) => it.u.symbol));
  let bFetched = 0, bFailed = 0;
  for (const sym of pickBuffett(items.filter((it) => !notScored(it.f)).map((it) => it.u.symbol), bCache, today, undefined, [...PLAN.picks.map((p) => p.symbol), ...PLAN.bench])) {
    const it = items.find((x) => x.u.symbol === sym);
    try {
      const q = buffettQuality(parseTimeseries(await fetchTimeseries(sym, TS_TYPES)), { sector: it.u.sector || it.f.sector, industry: it.f.industry });
      bCache[sym] = { date: today, q }; bFetched++;
    } catch { bFailed++; }
    await sleep(250);
  }
  await writeJson("data/buffett-sample.json", bCache);
  for (const it of items) { const q = freshQ(bCache, it.u.symbol, today); if (q) it.buffett = buffettLens(q, it.f.trailingPE); }
  { const lens = {}; for (const it of items) if (it.buffett) lens[it.u.symbol] = { ticker: it.u.symbol.replace(/\.L$/, ""), name: it.f.name || it.u.name, market: MARKET[it.u.index] ?? "US", sector: it.u.sector || it.f.sector, ...it.buffett };
    const counts = Object.groupBy(Object.values(lens), (x) => x.verdict);
    await writeJson("data/buffett.json", { updated: new Date().toISOString(), assessed: Object.keys(lens).length, universe: items.length, counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.length])), items: lens }); }
  // Lens track record (history/buffett-events.json). Never stops the scan.
  try {
    if (marketsClosed()) {
      const idxRows = {};
      for (const [m, sym] of [["US", "^GSPC"], ["UK", "^FTSE"], ["EU", "^STOXX50E"]]) { try { idxRows[m] = (await fetchDaily(sym, { range: "2y" })).rows; } catch { idxRows[m] = []; } }
      const lensNow = {};
      for (const it of items) if (it.buffett) lensNow[it.u.symbol] = { ...it.buffett, ticker: it.u.symbol.replace(/\.L$/, ""), market: MARKET[it.u.index] ?? "US" };
      const ev = updateLensEvents(await readJson("history/buffett-events.json", []), lensNow, rowsBySymbol, idxRows, Object.values(latest).sort().at(-1));
      await writeJson("history/buffett-events.json", ev, true);
      const sm = summariseLensEvents(ev);
      console.log(`Buffett lens track record: ${sm.zone.total} buy-zone and ${sm.quality.total} quality events (${sm.zone.open} and ${sm.quality.open} still listed).`);
    }
  } catch (e) { console.warn(`Buffett lens events failed: ${e.message}`); }
  console.log(`Buffett lens: ${bFetched} fetched, ${bFailed} failed, ${items.filter((it) => it.buffett).length} of ${items.length} assessed (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

  // Final scores with medians that include the deepened data. The old rule
  // (before 10 Nov) is kept only for the "what changed" note.
  const peerRows = peerRowsOf();
  const medians = sectorMedians(peerRows), regional = regionMedians(peerRows);
  const reitMed = reitMedian(items.filter((it) => it.deep).map((it) => it.f));
  for (const it of items) {
    // EV/EBITDA against the region's sector median (sample value for quick scores; live since 11 Nov).
    const ep = evPeer(it.f.evToEbitda ?? freshEv(evCache, it.u.symbol, today), it.u.sector || it.f.sector, MARKET[it.u.index] ?? "US", evMed);
    const { f: fs, peer } = withEv(it.f, peerOf(it, medians, regional), ep);
    it.lt = longTermLive(fs, it.t, peer);
    const old = longTerm(it.f, it.t);
    it.sv = peer ? sectorValueNote(fs, peer, old, it.lt, it.deep ? reitView(it.f, reitMed) : null) : null;
    it.rc = ruleChangeNote(old, it.lt);
    if (it.sv && ep) { it.sv.ev = ep; it.sv.note = `${it.sv.note} ${ep.note}`.trim(); }
  }

  // Results dates seen so far, so estimates learn each company's reporting gap.
  const resultsHist = await readJson("history/results-dates.json", {});
  for (const it of items) recordResults(resultsHist, it.u.symbol, [it.f.lastEarnings, it.f.nextEarnings], today);
  // Hand-kept real dates for the picks and bench (data/results-dates-known.json):
  // the busiest-day guess misdated some results days (data note 10 Nov).
  const knownDates = await readJson("data/results-dates-known.json", null);
  for (const [sym, ds] of Object.entries(knownDates?.dates ?? {})) recordResults(resultsHist, sym, ds, today);

  // Smart money (display only): 13F holdings of a few long-term managers,
  // refreshed weekly by tools/smart-money.mjs in this workflow.
  const smart = await readJson("data/smart-money.json", null);

  const out = items.map(({ u, t, f, signals, earningsDays, lt, swing, deep: isDeep, sv, rc, buffett }) => {
    const item = {
      symbol: u.symbol, ticker: u.symbol.replace(/\.L$/, ""), index: INDEX_LABEL[u.index], market: MARKET[u.index] ?? "US",
      name: f.name || u.name, sector: u.sector || f.sector, industry: f.industry ?? null, currency: f.currency ?? null,
      pe: r1(f.forwardPE > 0 ? f.forwardPE : f.trailingPE > 0 ? f.trailingPE : null), price: r2(t.last), date: t.date, marketCap: f.marketCap ?? null, dividendYield: f.dividendYield ?? null, beta: r2(f.beta),
      perf: { day: r1(t.dayPct), week: r1(t.weekPct), month: r1(t.monthPct), m3: r1(t.m3Pct), y1: r1(t.y1Pct), mom12_1: r1(t.mom12_1) },
      tech: { rsi: r1(t.rsi), vs50: r1(t.vs50), vs200: r1(t.vs200), offHigh: r1(t.offHigh), high52: r2(t.high52), low52: r2(t.low52), atrPct: r1(t.atrPct), volRatio: r2(t.volRatio) },
      target: f.targetMean ? { mean: r2(f.targetMean), high: r2(f.targetHigh), low: r2(f.targetLow), analysts: f.analysts, rec: r2(f.recommendationMean), recKey: f.recommendationKey } : null,
      ...earningsFields(f.nextEarnings, f.lastEarnings, today),
      longTerm: isDeep ? lt : { score: lt.score, verdict: lt.verdict, note: lt.note, gaps: lt.gaps, near: lt.near, coverage: lt.coverage, pillars: lt.pillars.map((p) => ({ key: p.key, label: p.label, score: p.score, items: [] })) },
      swing, signals, deep: isDeep, sectorValue: sv, ruleChange: rc,
      ...(buffett ? { buffett: { verdict: buffett.verdict, tone: buffett.tone, mos: buffett.mos, quality: buffett.quality ?? false } } : {}),
      // Rank: missing quality data (e.g. investment trusts) shouldn't float to the top.
      rank: lt.score == null ? null : Math.round(lt.score * (lt.pillars.find((p) => p.key === "quality")?.score == null && isDeep ? 0.85 : 1)),
      series: isDeep ? t.series : [],
    };
    const sm = smartFor(u.symbol, smart);
    if (sm) item.smartMoney = sm;
    // Sell and risk signals for holders (display only; tested in data/sell-study.json).
    const ex = latestSellSignals(rowsBySymbol[u.symbol]);
    item.exit = { kinds: ex.signals.map((x) => x.kind), stop: ex.stop };
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
      currency: i.currency, price: i.price, stop: i.swing.stop, score: i.swing.score, date: i.date,
      why: (i.signals || []).filter((x) => x.tone === "bull").map((x) => x.label).slice(0, 3) }));
    for (const [date, group] of Object.entries(Object.groupBy(setups, (x) => x.date))) paper = addSetups(paper, group, date);
  } else console.log("Paper trades: markets open, not updated.");
  await writeJson("history/paper-trades.json", paper, true);
  // Claude's swing book (paper): the funded swing rules applied to the log,
  // with the S&P 500 over the same days for comparison. Never stops the scan.
  try {
    const book = swingBook(paper, costR);
    let sp = null, spSeries = [];
    if (book.start) {
      const { rows } = await fetchDaily("^GSPC", { range: "1y" });
      const before = [...rows].reverse().find((r) => r.date < book.start), last = rows.at(-1);
      if (before && last) sp = { from: before.date, to: last.date, pct: r2(((last.close / before.close) - 1) * 100) };
      spSeries = benchSeries(rows, book.start);
    }
    const random = randomBooks(paper, costR, { runs: 200, seed: 7 });
    const closedAll = paper.filter((t) => t.status === "closed" && t.r != null);
    const everySetup = closedAll.length ? r2(closedAll.reduce((a, t) => a + t.r - costR(t), 0) / closedAll.length) : null;
    await writeJson("history/swing-book.json", { updated: new Date().toISOString(), ...book, sp, spSeries, random, everySetup: { closed: closedAll.length, avgNetR: everySetup } }, true);
    console.log(`Swing book (paper): ${book.returnPct}% since ${book.start} (S&P ${sp?.pct ?? "n/a"}%), ${book.open.length} open, ${book.orders.length} orders for the next session.`);
  } catch (e) { console.warn(`Swing book failed: ${e.message}`); }
  await writeJson("history/results-dates.json", resultsHist);
  // Swing lab: forward test of volume shocks, up and down (paper only;
  // research log 10 Nov). S&P 500 and FTSE 100 only, as tested. Never stops the scan.
  let drift = await readJson("history/swing-lab.json", []), driftToday_ = [];
  try {
    if (marketsClosed()) {
      const idx = {};
      for (const [m, sym] of [["US", "^GSPC"], ["UK", "^FTSE"]]) {
        try { idx[m] = new Map((await fetchDaily(sym, { range: "1y" })).rows.map((r) => [r.date, r.close])); } catch { idx[m] = null; }
      }
      drift = drift.map((t) => updateDrift(t, rowsBySymbol[t.symbol], idx[t.market]));
      for (const i of out) {
        if (i.index !== "S&P 500" && i.index !== "FTSE 100") continue;
        const sg = driftToday(rowsBySymbol[i.symbol]);
        if (!sg) continue;
        const near = i.lastEarnings && Math.abs(Date.parse(sg.date) - Date.parse(i.lastEarnings)) <= 3 * 86400000;
        driftToday_.push({ ...sg, symbol: i.symbol, ticker: i.ticker, name: i.name, market: i.market, results: !!near });
      }
      drift = addDrift(drift, driftToday_);
      await writeJson("history/swing-lab.json", drift, true);
    } else console.log("Swing lab: markets open, not updated.");
  } catch (e) { console.warn(`Swing lab failed: ${e.message}`); }
  // Drift book (paper, 11 Nov): a second book on the lab's drift signal,
  // built from the live log above. Never stops the scan.
  try {
    const db = driftBook(drift);
    let sp = null, spSeries = [];
    if (db.start) {
      const { rows } = await fetchDaily("^GSPC", { range: "1y" });
      const before = [...rows].reverse().find((r) => r.date < db.start), last = rows.at(-1);
      if (before && last) sp = { from: before.date, to: last.date, pct: r2(((last.close / before.close) - 1) * 100) };
      spSeries = benchSeries(rows, db.start);
    }
    const random = randomDriftBooks(drift, { runs: 200, seed: 11 });
    await writeJson("history/drift-book.json", { updated: new Date().toISOString(), ...db, sp, spSeries, random }, true);
    console.log(`Drift book (paper): ${db.returnPct}% since ${db.start ?? "n/a"}, ${db.open.length} open, ${db.orders.length} orders, ${db.closed} closed.`);
  } catch (e) { console.warn(`Drift book failed: ${e.message}`); }
  // Momentum book (paper, from Dec 2026; research log 11 Nov). Monthly
  // rebalance at the first session's open; marked nightly. Never stops the scan.
  try {
    let mb = await readJson("history/momentum-book.json", null) ?? newMomentumBook();
    for (const [market, idxName, idxSym] of [["US", "S&P 500", "^GSPC"], ["UK", "FTSE 100", "^FTSE"]]) {
      const idxRows = (await fetchDaily(idxSym, { range: "2y" })).rows, date = idxRows.at(-1)?.date;
      let mk = mb.markets[market];
      if (marketsClosed() && rebalanceDue(mk, date, process.env.PAPER_START || undefined)) {
        const month = date.slice(0, 7), members = out.filter((i) => i.index === idxName);
        const cands = [], opens = {};
        for (const i of members) {
          try {
            const { ends, open } = monthView((await fetchDaily(i.symbol, { range: "2y" })).rows, month);
            if (open) opens[i.symbol] = open;
            cands.push({ symbol: i.symbol, ticker: i.ticker, name: i.name, ends, open });
          } catch { /* skip */ }
          await sleep(60);
        }
        for (const p of mk.positions) if (opens[p.symbol] == null) { try { const v = monthView((await fetchDaily(p.symbol, { range: "1mo" })).rows, month); if (v.open) opens[p.symbol] = v.open; } catch {} }
        const up = trendUp(monthView(idxRows, month).ends);
        const picks = up === false ? [] : rankMomentum(cands);
        mk = rebalance(mk, { month, date, picks, opens, cost: momCost(market), trend: up });
        console.log(`Momentum book ${market}: rebalanced ${month} (${cands.length} ranked, trend ${up ? "up" : "down"}): ${mk.rebalances.at(-1).held.join(", ") || "cash"}.`);
      }
      const closes = {};
      for (const p of mk.positions) { const r = rowsBySymbol[p.symbol]?.at(-1); if (r) closes[p.symbol] = { date: r.date, close: r.close }; }
      mk = markBook(mk, closes, date);
      const st = mk.rebalances[0]?.date;
      if (st) { const b0 = [...idxRows].reverse().find((r) => r.date < st), b1 = idxRows.at(-1); if (b0 && b1) mk.bench = { name: idxName, from: b0.date, pct: r2((b1.close / b0.close - 1) * 100) }; }
      mb.markets[market] = mk;
    }
    mb.updated = new Date().toISOString();
    await writeJson("history/momentum-book.json", mb, true);
    console.log(`Momentum book (paper): US ${mb.markets.US.value}, UK ${mb.markets.UK.value}${mb.markets.US.lastRebalance ? "" : " (first rebalance from Dec 2026)"}.`);
  } catch (e) { console.warn(`Momentum book failed: ${e.message}`); }
  // Buffett book (paper, from Dec 2026; src/buffettBook.js). Never stops the scan.
  try {
    let bb = await readJson("history/buffett-book.json", null) ?? newBuffettBook();
    const date = Object.values(latest).sort().at(-1);
    if (marketsClosed()) {
      bb = fillOrders(bb, rowsBySymbol);
      if (reviewDue(bb, date, process.env.PAPER_START || undefined)) {
        const lens = {};
        for (const it of items) if (it.buffett) lens[it.u.symbol] = { ...it.buffett, ticker: it.u.symbol.replace(/\.L$/, ""), name: it.f.name || it.u.name, sector: it.u.sector || it.f.sector, market: MARKET[it.u.index] ?? "US" };
        bb = review(bb, lens, date);
        console.log(`Buffett book: review ${bb.lastReview}: ${bb.pending.map((o) => `${o.side} ${o.ticker}`).join(", ") || "no changes"}.`);
      }
    }
    bb = markBuffett(bb, rowsBySymbol, date);
    const bst = bb.trades[0]?.date;
    if (bst) { const sp = (await fetchDaily("^GSPC", { range: "2y" })).rows, b0 = [...sp].reverse().find((r) => r.date < bst), b1 = sp.at(-1); if (b0 && b1) bb.bench = { name: "S&P 500", from: b0.date, pct: r2((b1.close / b0.close - 1) * 100) }; }
    bb.updated = new Date().toISOString();
    await writeJson("history/buffett-book.json", bb, true);
    console.log(`Buffett book (paper): ${bb.value}, ${bb.positions.length} held, ${bb.pending.length} orders${bb.lastReview ? "" : " (first review from Dec 2026)"}.`);
  } catch (e) { console.warn(`Buffett book failed: ${e.message}`); }
  // Plan book (paper, from 16 Nov; src/planBook.js): the agreed plan and the
  // pending proposals on a notional £10,000, against all-VWRP. Never stops the scan.
  try {
    let pb = await readJson("history/plan-book.json", null) ?? newPlanBook();
    if (process.env.PLAN_START) pb.rules = { ...pb.rules, start: process.env.PLAN_START }; // dry runs only
    const date = Object.values(latest).sort().at(-1);
    if (marketsClosed()) {
      const core = await readJson("history/core-fund.json", {}), mon = await readJson("data.json", {}), stt = await readJson("state.json", {});
      const ck = Object.keys(core).filter((d) => d <= date).sort().at(-1);
      const prices = {}, checks = {};
      for (const p of PLAN.picks) { const r = rowsBySymbol[p.symbol]?.at(-1), it = items.find((x) => x.u.symbol === p.symbol); if (r) prices[p.symbol] = { close: r.close, market: it ? MARKET[it.u.index] ?? "US" : (p.symbol.endsWith(".L") ? "UK" : "US") }; }
      for (const c of mon?.copilot?.picks ?? []) checks[c.symbol] = { ok: !!c.ok, tone: c.resultsCheck?.tone ?? null, ticker: c.ticker };
      const tier = Math.min(0, ...Object.values(stt?.buyTier ?? {}).filter(Number.isFinite));
      if (ck && date.slice(0, 10) >= ck && (Date.parse(date) - Date.parse(ck)) / 86400000 <= 5) {
        const bbk = await readJson("history/buffett-book.json", null), mbk = await readJson("history/momentum-book.json", null);
        const mUS = mbk?.markets?.US, mUK = mbk?.markets?.UK;
        const pots = { buffett: bbk?.trades?.length ? bbk.value / bbk.rules.equity0 : null,
          momentum: mUS?.lastRebalance && mUK?.lastRebalance ? (mUS.value + mUK.value) / (2 * mbk.rules.equity0) : null };
        pb = stepPlanBook(pb, { date, vwrp: core[ck], prices, checks, tier, pots });
      }
      else console.log(`Plan book: no VWRP close near ${date} (latest ${ck ?? "none"}), not stepped.`);
    }
    pb.updated = new Date().toISOString();
    await writeJson("history/plan-book.json", pb, true);
    console.log(`Plan book (paper): ${planSummary(pb).map((x) => `${x.key} ${x.returnPct ?? "not started"}`).join(", ")}.`);
  } catch (e) { console.warn(`Plan book failed: ${e.message}`); }
  // Results check (swing lab round 4): the latest EPS surprise and the day's
  // reaction for the picks, the bench and tonight's results-day volume shocks.
  // Display only. Never stops the scan.
  try {
    const study = await readJson("data/surprise-study.json", null);
    const want = new Set([...PLAN.picks.map((p) => p.symbol), ...PLAN.bench, ...driftToday_.filter((x) => x.results).map((x) => x.symbol)]);
    let n = 0, tagged = 0;
    for (const it of out) {
      if (!want.has(it.symbol)) continue;
      try {
        const rd = await fetchResultsData(it.symbol), h = rd.history.at(-1), rows = rowsBySymbol[it.symbol];
        if (!h || !rows?.length) continue;
        // How far results days usually move it (all names, REITs included).
        const exact = reactionDays(rows, knownDates?.dates?.[it.symbol], (knownDates?.afterClose ?? []).includes(it.symbol));
        const moves = resultsMoves(rows, rd.history, it.lastEarnings, resultsHist[it.symbol] ?? [], exact);
        // Yahoo's REIT forecasts mix FFO with earnings per share, so REITs get the moves only.
        if (/REIT|Real Estate/i.test(it.sector || "")) { if (moves) it.resultsCheck = { moves }; continue; }
        const record = resultsRecord(rd.history, rd.next);
        const d = reportDay(rows, h.quarter, it.lastEarnings);
        if (d < 1 || (Date.now() - Date.parse(rows[d].date)) / 864e5 > 120) { it.resultsCheck = { record, ...(moves ? { moves } : {}) }; continue; }
        const reaction = Math.round((rows[d].close / rows[d - 1].close - 1) * 1000) / 10;
        it.resultsCheck = { quarter: h.quarter, date: rows[d].date, actual: h.actual, estimate: h.estimate, surprisePct: h.surprisePct, reaction, record, ...(moves ? { moves } : {}), ...resultsCheck({ surprisePct: h.surprisePct, reaction }, study) };
        const ev = driftToday_.find((x) => x.symbol === it.symbol);
        const lt = ev && drift.find((x) => x.id === `${ev.date}:${it.symbol}`);
        if (lt) { lt.surprisePct = h.surprisePct; tagged++; }
        n++;
      } catch { /* skip this one */ }
    }
    if (tagged && marketsClosed()) await writeJson("history/swing-lab.json", drift, true);
    await writeJson("data/results-check.json", { updated: new Date().toISOString(), items: Object.fromEntries(out.filter((i) => i.resultsCheck).map((i) => [i.symbol, i.resultsCheck])) }, true);
    console.log(`Results check: ${n} of ${want.size} with a recent EPS surprise; ${tagged} live events tagged.`);
  } catch (e) { console.warn(`Results check failed: ${e.message}`); }
  const driftSummary = { ...summariseDrift(drift), today: driftToday_ };
  console.log(`Swing lab volume shocks: ${driftToday_.length} new (${driftToday_.map((x) => `${x.ticker} ${x.movePct > 0 ? "+" : ""}${x.movePct}% ${x.volX}x`).join(", ") || "none"}); ${driftSummary.open} open; up ${driftSummary.up.n60} and down ${driftSummary.down.n60} closed.`);
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

  // Automatic data checks (display only) on the scan and the Research list.
  let dataChecks = null;
  try {
    const seen = new Set(out.map((i) => i.symbol));
    const list = ((await readJson("research.json", null))?.items ?? []).filter((i) => !seen.has(i.symbol)).map((i) => ({ ...i, list: true }));
    dataChecks = runDataChecks([...out, ...list], { asOf: today });
    console.log(dataChecksLine(dataChecks), dataChecks.flags.map((f) => `${f.ticker} ${f.key}: ${f.detail}`).join("; "));
  } catch (e) { console.warn(`Data checks failed: ${e.message}`); }

  await writeJson("scan.json", {
    updated: new Date().toISOString(), minutes: r1((Date.now() - t0) / 60000),
    universe: universe.length, scored: out.length, deepened: out.filter((i) => i.deep).length, failed,
    counts: Object.fromEntries(Object.entries(cons.indices).map(([k, v]) => [INDEX_LABEL[k], v.length])),
    newGood, newSetups, paper: paperSummary, swingLab: driftSummary, sectorMedians: medians, sectorMediansByRegion: regional, scoringVersion: SCORING_VERSION, reitPocf: reitMed, evSample: { ...evMed, fetched: evFetched, failed: evFailed }, ruleChanges: ruleChanges(out), coreExtras: coreDates, dataChecks, items: out,
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
