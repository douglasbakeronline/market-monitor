// Builds research.json for the research page and returns any new alerts.
import { CONFIG } from "./config.js";
import { fetchDaily } from "./data/prices.js";
import { fetchFundamentals } from "./data/fundamentals.js";
import { technicals, swingSignals, swingVerdict, longTerm, longTermLive, ruleChangeNote, SCORING_VERSION, freshSignal, regimeNote, daysUntil, earningsFields, resultsEstimate, summarise } from "./research.js";
import { smartFor, smartEvent } from "./smartMoney.js";
import { pickResultsLine, pickSellLine } from "./plan.js";
import { latestSellSignals } from "./sellSignals.js";
import { readJson, writeJson } from "./state.js";
import { peerFor, sectorValueNote, marketOf, reitView } from "./sectorValue.js";
import { evPeer, withEv } from "./evSample.js";
import { recordScores, scoreChange, recordEarnings, lastReaction, latestPast } from "./stockHistory.js";
import { r1, r2, sleep, dateIn } from "./util.js";

export async function loadList() {
  const list = await readJson("research-list.json", null);
  const stocks = list?.stocks?.length ? list.stocks : CONFIG.watchlist;
  return { placeholder: !!list?.placeholder || !list, stocks };
}

export async function runResearch({ regimeKey, state }) {
  const { placeholder, stocks } = await loadList();
  const today = dateIn("Europe/London");
  const items = [], failed = [], rowsBySymbol = {};
  let earnings = await readJson("history/earnings.json", {});
  // Sector medians from the latest index scan (display-only peer valuation).
  const scanMeta = await readJson("scan.json", null);
  const smart = await readJson("data/smart-money.json", null); // smart-money tags (display only)
  const rcMoves = (await readJson("data/results-check.json", null))?.items ?? {}; // usual results-day moves (display only)
  const medians = scanMeta?.sectorMedians ?? null, regional = scanMeta?.sectorMediansByRegion ?? null;
  for (const s of stocks) {
    try {
      const [prices, f] = [await fetchDaily(s.symbol, { range: "2y" }), await fetchFundamentals(s.symbol)];
      const t = technicals(prices.rows);
      rowsBySymbol[s.symbol] = prices.rows;
      earnings = recordEarnings(earnings, s.symbol, f?.nextEarnings);
      earnings = recordEarnings(earnings, s.symbol, f?.lastEarnings);
      const signals = swingSignals(t);
      const earningsDays = daysUntil(f?.nextEarnings, today);
      // Live scoring since 10 Nov: value against sector peers (medians from the
      // latest scan) and the new Entry rule; the old rule only for the note.
      // EV/EBITDA against the scan's peer sample (in the score since 11 Nov).
      const peer0 = f ? peerFor(f, medians, regional, marketOf(s.symbol)) : null;
      const ep = peer0 ? evPeer(f?.evToEbitda, f?.sector, marketOf(s.symbol), scanMeta?.evSample ?? null) : null;
      const { f: fs, peer } = withEv(f, peer0, ep);
      const lt = longTermLive(fs, t, peer), old = longTerm(f, t);
      const sectorValue = peer ? sectorValueNote(fs, peer, old, lt, reitView(f, scanMeta?.reitPocf ?? null)) : null;
      if (sectorValue && ep) Object.assign(sectorValue, { ev: ep, note: `${sectorValue.note} ${ep.note}`.trim() });
      const ruleChange = ruleChangeNote(old, lt);
      const swing = swingVerdict(t, signals, earningsDays);
      const item = {
        symbol: s.symbol, ticker: s.symbol.replace(/\.L$/, ""), market: marketOf(s.symbol),
        name: s.name || f?.name || prices.name || s.symbol, notes: s.notes || null,
        sector: f?.sector ?? null, industry: f?.industry ?? null,
        currency: prices.currency ?? f?.currency ?? null, price: r2(t?.last ?? prices.rows.at(-1)?.close), date: t?.date ?? null,
        pe: r1(f?.forwardPE > 0 ? f.forwardPE : f?.trailingPE > 0 ? f.trailingPE : null), marketCap: f?.marketCap ?? null, dividendYield: f?.dividendYield ?? null, beta: r2(f?.beta),
        perf: t ? { day: r1(t.dayPct), week: r1(t.weekPct), month: r1(t.monthPct), m3: r1(t.m3Pct), y1: r1(t.y1Pct), mom12_1: r1(t.mom12_1) } : null,
        tech: t ? { rsi: r1(t.rsi), vs50: r1(t.vs50), vs200: r1(t.vs200), offHigh: r1(t.offHigh), high52: r2(t.high52), low52: r2(t.low52), rangePos: r2(t.rangePos), atrPct: r1(t.atrPct), volRatio: r2(t.volRatio), sma50: r2(t.sma50), sma200: r2(t.sma200) } : null,
        target: f?.targetMean ? { mean: r2(f.targetMean), high: r2(f.targetHigh), low: r2(f.targetLow), analysts: f.analysts, rec: r2(f.recommendationMean), recKey: f.recommendationKey } : null,
        earnings: earningsFields(f?.nextEarnings, null, today).earnings,
        lastEarnings: latestPast([...(earnings[s.symbol] || []), f?.lastEarnings], today),
        lastResults: lastReaction(earnings[s.symbol], prices.rows, today),
        longTerm: lt, swing, signals, sectorValue, ruleChange,
        regimeNote: regimeNote(regimeKey, lt.verdict),
        series: t?.series ?? [],
      };
      const sm = smartFor(s.symbol, smart);
      if (sm) item.smartMoney = sm;
      const ex = latestSellSignals(prices.rows);
      item.exit = { kinds: ex.signals.map((x) => x.kind), stop: ex.stop };
      if (!item.earnings) item.resultsEstimate = resultsEstimate(item.lastEarnings, today, { uk: /\.L$/.test(s.symbol), history: earnings[s.symbol] || [] });
      item.summary = summarise(item);
      items.push(item);
    } catch (e) {
      console.warn(`Research failed for ${s.symbol}: ${e.message}`);
      failed.push(s.symbol);
    }
    await sleep(400);
  }

  // Score history (one point per day) and change over the past week.
  const scores = recordScores(await readJson("history/scores.json", {}), items, today);
  for (const it of items) {
    it.scoreHistory = (scores[it.symbol] || []).slice(-90);
    it.change = scoreChange(scores[it.symbol], today, 7, { ltFrom: SCORING_VERSION });
  }
  await writeJson("history/scores.json", scores);
  await writeJson("history/earnings.json", earnings);

  // Alerts: newly a "Good entry" (long-term) or a swing "Setup".
  const sellStudy = await readJson("data/sell-study.json", null);
  const prev = state.research || {}, next = {}, lines = [], pickLines = [], events = [];
  const at = new Date().toISOString();
  for (const it of items) {
    const p = prev[it.symbol] || {};
    // A stock just added to the list is recorded silently, not announced as new.
    const sme = smartEvent(p.sm, it.smartMoney);
    if (!prev[it.symbol]) { next[it.symbol] = { lt: it.longTerm.verdict, sw: it.swing?.verdict ?? null, sm: sme.key, v: SCORING_VERSION }; continue; }
    const lt = it.longTerm.verdict, sw = it.swing?.verdict ?? null;
    // After a scoring rule change, the old verdict is not comparable: re-baseline
    // the long-term verdict silently (swing and smart money carry on).
    if (p.v !== SCORING_VERSION) p.lt = lt;
    const ed = it.earnings?.days;
    const earn = ed != null && ed >= 0 && ed <= 7 ? ` Earnings ${ed === 0 ? "today" : ed === 1 ? "tomorrow" : `in ${ed} days`}: consider waiting for the results.` : "";
    const move = it.perf?.day != null ? `, ${it.perf.day >= 0 ? "+" : ""}${it.perf.day}% today` : "";
    const ev = (kind, label) => events.push({ kind, at, date: it.date, symbol: it.symbol, ticker: it.ticker, name: it.name, price: it.price, currency: it.currency, label });
    // g / s: last day it was a good entry / a setup (flicker guard, freshSignal()).
    const isGood = lt === "Good entry", isSetup = !!sw?.startsWith("Setup");
    const newGood = freshSignal(isGood, p.lt === "Good entry", p.g, today), newSetup = freshSignal(isSetup, !!p.sw?.startsWith("Setup"), p.s, today);
    if (newGood) ev("research-lt", `Long-term good entry (${it.longTerm.score})`);
    if (newSetup) ev("research-swing", `Swing setup (${it.swing.score})`);
    if (newGood) lines.push(`${it.ticker}: now a long-term good entry (${it.longTerm.score}/100, was ${(p.lt || "unscored").toLowerCase()}${move}).${earn}`);
    if (newSetup) lines.push(`${it.ticker}: swing setup (${it.signals.filter((x) => x.tone === "bull").map((x) => x.label.toLowerCase()).slice(0, 2).join(", ")}).${earn}`);
    if (sme.fire) ev("smart", sme.label); // track record only, no push alert (tie-breaker)
    // rr: the pick's results date already announced (null = none yet).
    const rl = pickResultsLine(it, "rr" in p ? p.rr : undefined, undefined, rcMoves[it.symbol]?.moves);
    if (rl) pickLines.push(rl);
    const sl = pickSellLine(it, sellStudy);
    if (sl) pickLines.push(sl);
    const rr = it.lastResults && !it.lastResults.pending ? it.lastResults.date : p.rr ?? null;
    next[it.symbol] = { lt, sw, sm: sme.key, v: SCORING_VERSION, g: isGood ? today : p.g ?? null, s: isSetup ? today : p.s ?? null, rr };
  }
  for (const sym of failed) if (prev[sym]) next[sym] = prev[sym]; // keep memory through a failed fetch
  // First run: record a baseline silently rather than announce everything as new.
  const baseline = Object.keys(prev).length === 0;
  const alerts = lines.length && !baseline ? [{ kind: "research", priority: "default", tags: "mag", click: CONFIG.researchUrl,
    title: `Research · ${lines.length} update${lines.length > 1 ? "s" : ""}`, body: lines.join("\n") }] : [];
  // News on the five picks goes as its own push (kept under the plan-swing alert profile).
  if (pickLines.length && !baseline) alerts.push({ kind: "research-pick", priority: "default", tags: "mag", click: CONFIG.researchUrl,
    title: `Your picks · ${pickLines.length} update${pickLines.length > 1 ? "s" : ""}`, body: pickLines.join("\n") });

  return {
    data: { updated: new Date().toISOString(), scoringVersion: SCORING_VERSION, placeholder, regime: regimeKey, count: items.length, failed, items },
    alerts, researchState: next, events: baseline ? [] : events, rowsBySymbol,
  };
}
