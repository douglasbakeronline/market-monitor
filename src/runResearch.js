// Builds research.json for the research page and returns any new alerts.
import { CONFIG } from "./config.js";
import { fetchDaily } from "./data/prices.js";
import { fetchFundamentals } from "./data/fundamentals.js";
import { technicals, swingSignals, swingVerdict, longTerm, regimeNote, daysUntil, summarise } from "./research.js";
import { readJson, writeJson } from "./state.js";
import { recordScores, scoreChange, recordEarnings, lastReaction } from "./stockHistory.js";
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
  for (const s of stocks) {
    try {
      const [prices, f] = [await fetchDaily(s.symbol, { range: "2y" }), await fetchFundamentals(s.symbol)];
      const t = technicals(prices.rows);
      rowsBySymbol[s.symbol] = prices.rows;
      earnings = recordEarnings(earnings, s.symbol, f?.nextEarnings);
      const signals = swingSignals(t);
      const earningsDays = daysUntil(f?.nextEarnings, today);
      const lt = longTerm(f, t);
      const swing = swingVerdict(t, signals, earningsDays);
      const item = {
        symbol: s.symbol, ticker: s.symbol.replace(/\.L$/, ""), market: s.symbol.endsWith(".L") ? "UK" : "US",
        name: s.name || f?.name || prices.name || s.symbol, notes: s.notes || null,
        sector: f?.sector ?? null, industry: f?.industry ?? null,
        currency: prices.currency ?? f?.currency ?? null, price: r2(t?.last ?? prices.rows.at(-1)?.close), date: t?.date ?? null,
        marketCap: f?.marketCap ?? null, dividendYield: f?.dividendYield ?? null, beta: r2(f?.beta),
        perf: t ? { day: r1(t.dayPct), week: r1(t.weekPct), month: r1(t.monthPct), m3: r1(t.m3Pct), y1: r1(t.y1Pct) } : null,
        tech: t ? { rsi: r1(t.rsi), vs50: r1(t.vs50), vs200: r1(t.vs200), offHigh: r1(t.offHigh), high52: r2(t.high52), low52: r2(t.low52), rangePos: r2(t.rangePos), atrPct: r1(t.atrPct), volRatio: r2(t.volRatio), sma50: r2(t.sma50), sma200: r2(t.sma200) } : null,
        target: f?.targetMean ? { mean: r2(f.targetMean), high: r2(f.targetHigh), low: r2(f.targetLow), analysts: f.analysts, rec: r2(f.recommendationMean), recKey: f.recommendationKey } : null,
        earnings: f?.nextEarnings ? { date: f.nextEarnings, days: earningsDays } : null,
        lastResults: lastReaction(earnings[s.symbol], prices.rows, today),
        longTerm: lt, swing, signals,
        regimeNote: regimeNote(regimeKey, lt.verdict),
        series: t?.series ?? [],
      };
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
    it.change = scoreChange(scores[it.symbol], today, 7);
  }
  await writeJson("history/scores.json", scores);
  await writeJson("history/earnings.json", earnings);

  // Alerts: newly a "Good entry" (long-term) or a swing "Setup".
  const prev = state.research || {}, next = {}, lines = [], events = [];
  const at = new Date().toISOString();
  for (const it of items) {
    const p = prev[it.symbol] || {};
    const lt = it.longTerm.verdict, sw = it.swing?.verdict ?? null;
    const ed = it.earnings?.days;
    const earn = ed != null && ed >= 0 && ed <= 7 ? ` Earnings ${ed === 0 ? "today" : ed === 1 ? "tomorrow" : `in ${ed} days`}: consider waiting for the results.` : "";
    const move = it.perf?.day != null ? `, ${it.perf.day >= 0 ? "+" : ""}${it.perf.day}% today` : "";
    const ev = (kind, label) => events.push({ kind, at, date: it.date, symbol: it.symbol, ticker: it.ticker, name: it.name, price: it.price, currency: it.currency, label });
    if (lt === "Good entry" && p.lt !== "Good entry") ev("research-lt", `Long-term good entry (${it.longTerm.score})`);
    if (sw?.startsWith("Setup") && !p.sw?.startsWith("Setup")) ev("research-swing", `Swing setup (${it.swing.score})`);
    if (lt === "Good entry" && p.lt !== "Good entry") lines.push(`${it.ticker}: now a long-term good entry (${it.longTerm.score}/100, was ${(p.lt || "unscored").toLowerCase()}${move}).${earn}`);
    if (sw?.startsWith("Setup") && !p.sw?.startsWith("Setup")) lines.push(`${it.ticker}: swing setup (${it.signals.filter((x) => x.tone === "bull").map((x) => x.label.toLowerCase()).slice(0, 2).join(", ")}).${earn}`);
    next[it.symbol] = { lt, sw };
  }
  for (const sym of failed) if (prev[sym]) next[sym] = prev[sym]; // keep memory through a failed fetch
  // First run: record a baseline silently rather than announce everything as new.
  const baseline = Object.keys(prev).length === 0;
  const alerts = lines.length && !baseline ? [{ kind: "research", priority: "default", tags: "mag", click: CONFIG.researchUrl,
    title: `Research · ${lines.length} new signal${lines.length > 1 ? "s" : ""}`, body: lines.join("\n") }] : [];

  return {
    data: { updated: new Date().toISOString(), placeholder, regime: regimeKey, count: items.length, failed, items },
    alerts, researchState: next, events: baseline ? [] : events, rowsBySymbol,
  };
}
