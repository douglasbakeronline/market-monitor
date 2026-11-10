// Market monitor: entry point. Run by GitHub Actions at each scheduled slot
// (see src/config.js), or by hand:
//   node monitor.js                 normal run (time-based behaviour)
//   SLOT=us-open node monitor.js    behave as a specific slot
//   DRY_RUN=1 node monitor.js       real data, no notifications, writes to ./dry-run/
//   FORCE_SUMMARY=US node monitor.js  send a summary now (UK or US)

import { CONFIG } from "./src/config.js";
import { fetchFearGreed, ratingFor } from "./src/data/feargreed.js";
import { fetchDaily, fetchMany } from "./src/data/prices.js";
import { snapshot, regime, marketStatus, evaluateAlerts, watchItem, buildFearSessions } from "./src/signals.js";
import { forwardReturns, contextLine, mergeHistory } from "./src/context.js";
import { runResearch } from "./src/runResearch.js";
import { notify } from "./src/notify.js";
import { logSignals, evaluate as evaluateSignals, summarise as summariseSignals, byKind as signalsByKind, byMarket as signalsByMarket, byScore as signalsByScore, byHorizon as signalsByHorizon, digestKindLine, KIND_LABEL } from "./src/trackRecord.js";
import { loadState, saveState, readJson, writeJson } from "./src/state.js";
import { slotById, inQuietHours } from "./src/schedule.js";
import { copilot, pullbackAlert, copilotLines, picksWeekLine } from "./src/plan.js";
import { parseAlerts, latestPrice, checkAlerts, digestLine as alertDigestLine } from "./src/priceAlerts.js";
import { coreFundView, coreFundLine, drawdownTag } from "./src/coreFund.js";
import { digestLine as rebalanceDigestLine } from "./src/rebalance.js";
import { bookLine, bookNews } from "./src/swingBook.js";
import { SCORING_VERSION } from "./src/research.js";
import { partsIn, dateIn, isoWeek, sign, addDays } from "./src/util.js";

const hoursSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3600000 : Infinity);

async function main() {
  const state = await loadState();
  const slot = slotById(process.env.SLOT);
  const now = new Date();
  console.log(`Run at ${now.toISOString()}${slot ? ` for slot ${slot.id}` : ""}${process.env.DRY_RUN ? " (dry run)" : ""}`);

  // --- 1. Fear & Greed --------------------------------------------------------
  let fg = null, fgOk = false;
  try {
    fg = await fetchFearGreed();
    fgOk = true;
    state.lastGood.fg = fg;
    state.lastGood.fgAt = now.toISOString();
  } catch (e) {
    console.error(`Fear & Greed unavailable: ${e.message}`);
    fg = state.lastGood.fg || null;
  }

  // Long history for context (CNN from mid-2020), stored so it keeps growing.
  let fgHistory = await readJson("history/fear-greed.json", {});
  if (Object.keys(fgHistory).length < 1000) {
    try { fgHistory = mergeHistory(fgHistory, (await fetchFearGreed("2020-07-15")).history); }
    catch (e) { console.warn(`Long F&G history unavailable: ${e.message}`); }
  }
  if (fg?.history) fgHistory = mergeHistory(fgHistory, fg.history);

  // --- 2. Index prices ---------------------------------------------------------
  const spData = await fetchDaily("^GSPC", { range: "10y" }).catch((e) => { console.error(`S&P 500 unavailable: ${e.message}`); return null; });
  const others = await fetchMany(CONFIG.world.filter((w) => w.symbol !== "^GSPC").map((w) => w.symbol).concat(CONFIG.indices.vix.symbol, CONFIG.coreFund.symbol), { range: "2y" });
  const series = { "^GSPC": spData, ...others };

  let sp = snapshot("S&P 500", "^GSPC", spData);
  let ftse = snapshot("FTSE 100", "^FTSE", series["^FTSE"]);
  const vixRows = series["^VIX"]?.rows;
  let vix = vixRows?.length ? { level: vixRows.at(-1).close, dayPct: vixRows.length > 1 ? Math.round(((vixRows.at(-1).close / vixRows.at(-2).close) - 1) * 1000) / 10 : null, date: vixRows.at(-1).date } : null;

  if (sp) state.lastGood.markets = { sp, ftse: ftse ?? state.lastGood.markets?.ftse ?? null, vix, at: now.toISOString() };
  else if (state.lastGood.markets) {
    ({ sp, vix } = state.lastGood.markets);
    ftse = ftse ?? state.lastGood.markets.ftse;
    console.warn(`Using last good index data from ${state.lastGood.markets.at}`);
  }
  const priceAge = hoursSince(sp?.asOf ?? (sp ? `${sp.date}T21:00:00Z` : null));
  const pricesOk = !!sp && priceAge <= CONFIG.staleHours && hoursSince(state.lastGood.markets?.at) <= CONFIG.staleHours;

  const world = buildWorld(series, sp);
  // The core fund itself, in pounds (display only; rules use the indices).
  let coreFund = coreFundView(snapshot(CONFIG.coreFund.name, CONFIG.coreFund.symbol, series[CONFIG.coreFund.symbol]), sp, CONFIG.coreFund);
  if (coreFund) state.lastGood.coreFund = coreFund;
  else if (state.lastGood.coreFund) { coreFund = state.lastGood.coreFund; console.warn("Core fund: using the last good value."); }

  // --- 3. Watchlist ---------------------------------------------------------------
  const wlData = await fetchMany(CONFIG.watchlist.map((w) => w.symbol), { range: "6mo" });
  let watchlist = CONFIG.watchlist.map((w) => watchItem(w, wlData[w.symbol])).filter(Boolean);
  if (!watchlist.length && state.lastGood.watchlist) watchlist = state.lastGood.watchlist;
  else if (watchlist.length) state.lastGood.watchlist = watchlist;

  // --- 3b. Price alerts (price-alerts.json; levels in the quote currency) --------
  const paParsed = parseAlerts(await readJson("price-alerts.json", []));
  for (const x of paParsed.invalid) console.warn(`Price alert skipped (${x.reason}): ${x.symbol ?? "no symbol"}`);
  const paSymbols = [...new Set(paParsed.alerts.map((a) => a.symbol))];
  const paMissing = paSymbols.filter((s) => !wlData[s]);
  const paData = paMissing.length ? await fetchMany(paMissing, { range: "5d" }) : {};
  const paPrices = Object.fromEntries(paSymbols.map((s) => [s, latestPrice((wlData[s] ?? paData[s])?.rows, now)]));
  const pa = checkAlerts(paParsed, paPrices, state.priceAlerts ?? {}, now);
  state.priceAlerts = pa.state;
  if (paParsed.alerts.length) console.log(`Price alerts: ${paParsed.alerts.length} checked, ${pa.alerts.length} fired`);

  // --- 4. Regime, status, context ---------------------------------------------
  const reg = regime({ sp: pricesOk ? sp : null, vix, fg: fgOk ? fg : (hoursSince(state.lastGood.fgAt) < 24 ? fg : null) });
  const status = { US: marketStatus(sp, fg, vix), UK: marketStatus(ftse, fg, vix) };
  const ctx = fg && spData?.rows ? forwardReturns(fgHistory, spData.rows, fg.score) : (state.lastGood.context ?? null);
  if (ctx) state.lastGood.context = ctx;

  // --- 5. Fear & Greed open/close capture (US session) ---------------------------
  const usDate = dateIn("America/New_York");
  const ny = partsIn("America/New_York");
  const isWeekday = ny.weekday >= 1 && ny.weekday <= 5;
  const cap = slot?.fearCapture ?? (isWeekday && ny.min >= 570 && ny.min <= 630 ? "open" : isWeekday && ny.min >= 955 && ny.min <= 1020 ? "close" : null);
  if (fgOk && cap === "open" && state.fearLog[usDate]?.open == null) state.fearLog[usDate] = { ...(state.fearLog[usDate] || {}), open: fg.score };
  if (fgOk && cap === "close") state.fearLog[usDate] = { ...(state.fearLog[usDate] || {}), close: fg.score };
  const fk = Object.keys(state.fearLog).sort();
  while (fk.length > 30) delete state.fearLog[fk.shift()];
  const fearSessions = buildFearSessions(fg?.history ?? [], state.fearLog);

  // --- 6. Research -------------------------------------------------------------
  const existingResearch = await readJson("research.json", null);
  const scan = await readJson("scan.json", null);
  let researchAlerts = [], researchEvents = [], researchRows = {}, research = existingResearch;
  // A scoring rule change (SCORING_VERSION) refreshes research at the next run,
  // so the list and the pick tranche check never show the old rule's verdicts.
  if (slot?.research || process.env.FORCE_RESEARCH || hoursSince(existingResearch?.updated) > 26 || existingResearch?.scoringVersion !== SCORING_VERSION) {
    try {
      const r = await runResearch({ regimeKey: reg.key, state });
      research = r.data;
      researchAlerts = r.alerts;
      researchEvents = r.events;
      researchRows = r.rowsBySymbol;
      state.research = r.researchState;
      await writeJson("research.json", research);
      console.log(`Research: ${research.count} stocks scored${research.failed.length ? `, failed: ${research.failed.join(", ")}` : ""}`);
    } catch (e) { console.error(`Research run failed: ${e.message}`); }
  }

  // --- 7. Health ----------------------------------------------------------------
  const today = dateIn("Europe/London");
  const problems = [];
  if (!pricesOk) problems.push(`index prices ${sp ? `are stale (last ${sp.date})` : "unavailable"}`);
  if (!fgOk) problems.push("Fear & Greed unavailable");
  const health = { ok: problems.length === 0, problems, priceAge: Number.isFinite(priceAge) ? Math.round(priceAge) : null, checkedAt: now.toISOString() };
  const alerts = [];
  if (!health.ok && state.health.alertedDate !== today) {
    alerts.push({ kind: "health", priority: "high", tags: "warning", title: "Monitor problem: signals paused", body: `The monitor couldn't refresh: ${problems.join("; ")}. Price-based signals are paused until data returns. The dashboard shows the last good values.` });
    state.health.alertedDate = today;
  }
  if (health.ok && state.health.alertedDate) {
    alerts.push({ kind: "health", priority: "low", tags: "white_check_mark", title: "Monitor recovered", body: "Data is flowing again and signals are back on." });
    state.health.alertedDate = null;
  }

  // --- 8. Signal alerts ----------------------------------------------------------
  const ev = evaluateAlerts({ markets: { US: sp, UK: ftse }, fg, vix, pricesOk, fgOk }, state);
  Object.assign(state, ev.state);
  alerts.push(...ev.alerts, ...researchAlerts, ...pa.alerts);

  // Co-pilot: what the agreed plan says is due, plus the pullback rule.
  const planItems = Object.fromEntries([...(scan?.coreExtras ?? []), ...(scan?.items ?? []), ...(research?.items ?? [])].map((i) => [i.symbol, i]));
  // Confirmed buy tiers so far (they pause the monthly reserve drip).
  const tiers = (await readJson("history/signals.json", [])).filter((x) => x?.kind === "buy" && x.date).map((x) => x.date);
  const cp = copilot({ today, sp: pricesOk ? sp : null, ftse: pricesOk ? ftse : null, items: planItems, tiers });
  const pb = pullbackAlert(cp, state);
  if (pb) alerts.push(pb);
  // Claude's swing book (paper): a push when it places orders or closes trades.
  const bn = bookNews(await readJson("history/swing-book.json", null), state.bookSeen ?? null);
  state.bookSeen = bn.seen;
  if (bn.line) alerts.push({ kind: "book", priority: "low", tags: "chart_with_upwards_trend", title: `Swing book (paper) · ${today}`, body: `${bn.line} Paper only: no real money.` });
  // Track record: log today's signals with prices, then score all past ones.
  const marketEvents = ev.alerts.filter((a) => KIND_LABEL[a.kind]).map((a) => {
    const snap = a.market === "UK" ? ftse : sp;
    return snap && { kind: a.kind, at: now.toISOString(), date: snap.date, symbol: snap.symbol, ticker: snap.name, name: snap.name, price: snap.level, label: a.title };
  });
  const rowsBySymbol = { ...Object.fromEntries(Object.entries(wlData).filter(([, v]) => v).map(([k, v]) => [k, v.rows])), ...researchRows };
  if (spData?.rows) rowsBySymbol["^GSPC"] = spData.rows;
  if (series["^FTSE"]?.rows) rowsBySymbol["^FTSE"] = series["^FTSE"].rows;
  if (series["^STOXX50E"]?.rows) rowsBySymbol["^STOXX50E"] = series["^STOXX50E"].rows; // home index for European names
  let signalLog = logSignals(await readJson("history/signals.json", []), [...marketEvents, ...researchEvents]);
  signalLog = evaluateSignals(signalLog, rowsBySymbol, spData?.rows ?? null);
  await writeJson("history/signals.json", signalLog, true);
  const trackRecord = { summary: summariseSignals(signalLog), byKind: signalsByKind(signalLog), byMarket: signalsByMarket(signalLog), byScore: signalsByScore(signalLog), byHorizon: signalsByHorizon(signalLog), recent: signalLog.slice(-25).reverse() };

  const ctxLine = contextLine(ctx);
  for (const a of alerts) if (["buy", "watch", "fear-no-dip"].includes(a.kind) && ctxLine) a.body += `\n${ctxLine}`;
  const quiet = inQuietHours(now);
  state.pending = state.pending || [];
  if (!quiet && state.pending.length) {
    for (const a of state.pending) { console.log(`ALERT (held overnight) ${a.title}`); await notify({ ...a, body: `${a.body}\n(Held from ${a.heldAt}.)` }); }
    state.pending = [];
  }
  for (const a of alerts) {
    if (quiet && a.kind !== "health" && a.priority !== "urgent") {
      console.log(`HELD for quiet hours: ${a.title}`);
      state.pending = state.pending.filter((p) => p.title !== a.title).concat({ ...a, heldAt: new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }) });
      continue;
    }
    console.log(`ALERT ${a.title}`);
    await notify(a);
  }

  // --- 9. Daily summaries ----------------------------------------------------------
  const lon0 = partsIn("Europe/London");
  const due = [];
  if (process.env.FORCE_SUMMARY) due.push(process.env.FORCE_SUMMARY.toUpperCase() === "UK" ? "UK" : "US");
  else for (const market of ["UK", "US"]) {
    const s = CONFIG.slots.find((x) => x.summary === market);
    const p = partsIn(s.tz);
    const [hh, mm] = s.time.split(":").map(Number);
    const close = market === "UK" ? 16 * 60 + 30 : 16 * 60;
    const inWindow = p.weekday >= 1 && p.weekday <= 5 && p.min >= hh * 60 + mm - 5 && p.min <= close;
    if ((slot?.summary === market || inWindow) && state.summarySent[market] !== p.date) due.push(market);
  }
  for (const market of due) {
    const tz = market === "UK" ? "Europe/London" : "America/New_York";
    const planLines = market === "UK" && (lon0.weekday === 1 || cp.actions.some((a) => a.inDays <= 1)) ? copilotLines(cp) : [];
    await notify({ title: `${market} open · ${reg.label}`, body: [...planLines, summaryBody({ market, reg, fg, fgOk, sp, ftse, vix, ctxLine, watchlist, research, scan })].join("\n"), priority: "default", tags: market === "UK" ? "gb" : "us" });
    state.summarySent[market] = dateIn(tz);
    console.log(`Sent ${market} summary.`);
  }

  // --- 10. Weekly digest (Sunday evening) ------------------------------------------
  const lon = partsIn("Europe/London");
  const week = isoWeek(lon.date);
  if ((slot?.digest || process.env.FORCE_DIGEST || (lon.weekday === 0 && lon.min >= 17 * 60 + 55)) && (state.digestSent !== week || process.env.FORCE_DIGEST)) {
    await notify({ title: `Weekly digest · ${reg.label}`, body: [digestBody({ reg, fg, sp, ftse, vix, world, coreFund, ctxLine, research, trackRecord, scan, priceAlerts: pa.view, planItems, book: await readJson("history/swing-book.json", null) }), "", "Coming week:", ...copilotLines(copilot({ today: addDays(today, 1), sp: pricesOk ? sp : null, ftse: pricesOk ? ftse : null, items: planItems, tiers }))].join("\n"), priority: "low", tags: "calendar" });
    state.digestSent = week;
    console.log("Sent weekly digest.");
  }

  // --- 11. Persist ----------------------------------------------------------------
  console.log(`F&G ${fg?.score ?? "n/a"} (${fg ? ratingFor(fg.score) : "n/a"}) | S&P ${sp ? sp.drawdownPct.toFixed(1) + "% off high" : "n/a"} | VIX ${vix?.level?.toFixed(1) ?? "n/a"} | ${reg.label}`);
  await writeJson("data.json", {
    updated: now.toISOString(), slot: slot?.id ?? null, health,
    score: fg?.score ?? null, rating: fg ? ratingFor(fg.score) : null, fgAsOf: fg?.asOf ?? null,
    comparisons: fg?.comparisons ?? null, components: fg?.components ?? [],
    history: (fg?.history ?? []).slice(-CONFIG.historyPoints).map((h) => ({ t: h.t, d: h.date, y: h.y })),
    regime: reg, status, markets: { sp, ftse, vix }, context: ctx, fearSessions, world, coreFund, watchlist,
    researchTop: researchHighlights(research), trackRecord, copilot: cp,
    paper: scan?.paper ?? null,
    priceAlerts: { items: pa.view, invalid: pa.invalid },
  });
  await writeJson("history/fear-greed.json", fgHistory);
  await saveState(state);
}

// --- Builders ------------------------------------------------------------------


function buildWorld(series, sp) {
  const markets = CONFIG.world.map((w) => {
    const s = w.symbol === "^GSPC" ? sp : snapshot(w.name, w.symbol, series[w.symbol]);
    return s ? { name: w.name, symbol: w.symbol, dayPct: s.dayPct, weekPct: s.weekPct, monthPct: s.monthPct, drawdownPct: s.drawdownPct, tag: drawdownTag(s.drawdownPct), above200: s.above200, series: s.series } : null;
  }).filter(Boolean);
  if (!markets.length) return null;
  let score = 0;
  for (const m of markets) {
    score += Math.max(-1, Math.min(1, (m.dayPct ?? 0) / 1.5));
    score += Math.max(-1, Math.min(1, (m.weekPct ?? 0) / 4));
  }
  score = Math.round(Math.max(-10, Math.min(10, score)));
  const label = score >= 6 ? "Risk-on, broad rally" : score >= 2 ? "Mostly up" : score >= -1 ? "Mixed / flat" : score >= -5 ? "Mostly down" : "Risk-off, broad sell-off";
  return { score, label, markets, above200: markets.filter((m) => m.above200).length };
}

function researchHighlights(r) {
  if (!r?.items?.length) return null;
  const lt = r.items.filter((i) => ["Good entry", "Fair"].includes(i.longTerm.verdict)).sort((a, b) => b.longTerm.score - a.longTerm.score).slice(0, 5)
    .map((i) => ({ ticker: i.ticker, name: i.name, verdict: i.longTerm.verdict, score: i.longTerm.score }));
  const sw = r.items.filter((i) => i.swing?.verdict?.startsWith("Setup")).sort((a, b) => b.swing.score - a.swing.score).slice(0, 5)
    .map((i) => ({ ticker: i.ticker, name: i.name, verdict: i.swing.verdict, score: i.swing.score }));
  const earnings = r.items.filter((i) => i.earnings?.days != null && i.earnings.days >= 0 && i.earnings.days <= 7)
    .sort((a, b) => a.earnings.days - b.earnings.days).map((i) => ({ ticker: i.ticker, date: i.earnings.date, days: i.earnings.days }));
  const today = dateIn("Europe/London");
  const reactions = r.items.filter((i) => i.lastResults && !i.lastResults.pending && Date.parse(today) - Date.parse(i.lastResults.to) <= 3 * 86400000)
    .map((i) => ({ ticker: i.ticker, date: i.lastResults.date, pct: i.lastResults.pct })).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const movers = r.items.filter((i) => i.change?.lt != null && Math.abs(i.change.lt) >= 8)
    .map((i) => ({ ticker: i.ticker, change: i.change.lt, score: i.longTerm.score })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);
  return { updated: r.updated, longTerm: lt, swing: sw, earnings, reactions, movers, placeholder: r.placeholder };
}

// One line on the index scan for summaries: good entries and new names.
function scanLine(scan, market) {
  if (!scan?.items?.length || Date.now() - Date.parse(scan.updated) > 4 * 86400000) return null;
  const pool = scan.items.filter((i) => !market || i.market === market);
  const good = pool.filter((i) => i.deep && i.longTerm.verdict === "Good entry");
  const fresh = good.filter((i) => scan.newGood?.includes(i.symbol)).map((i) => i.ticker);
  const setups = pool.filter((i) => i.swing?.verdict?.startsWith("Setup")).length;
  const idx = market === "UK" ? "FTSE 100" : market === "US" ? "S&P 500" : "Index";
  if (!good.length && !setups) return null;
  return `${idx} scan: ${good.length} good entr${good.length === 1 ? "y" : "ies"}${good.length ? ` (top: ${good.slice(0, 3).map((i) => i.ticker).join(", ")})` : ""}${fresh.length ? `, new: ${fresh.join(", ")}` : ""}; ${setups} swing setup${setups === 1 ? "" : "s"}.`;
}

function summaryBody({ market, reg, fg, fgOk, sp, ftse, vix, ctxLine, watchlist, research, scan }) {
  const L = [];
  if (fg) L.push(`F&G ${fg.score} (${ratingFor(fg.score)})${fg.comparisons ? `, prev close ${fg.comparisons.close}, week ago ${fg.comparisons.week}` : ""}${fgOk ? "" : " [stale]"}${vix ? `. VIX ${vix.level.toFixed(1)}` : ""}.`);
  if (sp) L.push(`S&P 500 ${Math.round(sp.level).toLocaleString("en-GB")}: ${sp.drawdownPct.toFixed(1)}% off high, ${sp.vs200Pct >= 0 ? "+" : ""}${sp.vs200Pct?.toFixed(1)}% vs 200-day.`);
  if (ftse) L.push(`FTSE 100 ${Math.round(ftse.level).toLocaleString("en-GB")}: ${ftse.drawdownPct.toFixed(1)}% off high.`);
  const spLast = sp?.fiveDay?.at(-1), ftLast = ftse?.fiveDay?.at(-1);
  L.push(`Last session: S&P ${sign(spLast?.pct)}, FTSE ${sign(ftLast?.pct)}.`);
  L.push(`→ ${reg.action}`);
  if (ctxLine) L.push(ctxLine);
  const reb = (watchlist || []).filter((w) => w.rebound).sort((a, b) => a.dropFromHigh - b.dropFromHigh).map((w) => `${w.symbol} ${w.dropFromHigh}%`);
  L.push(`Rebound watch: ${reb.length ? reb.join(", ") : "none"}.`);
  const sl = scanLine(scan, market);
  if (sl) L.push(sl);
  const h = researchHighlights(research);
  if (h) {
    const mk = (xs) => xs.map((x) => x.ticker).join(", ");
    if (h.longTerm.some((x) => x.verdict === "Good entry")) L.push(`Long-term good entries: ${mk(h.longTerm.filter((x) => x.verdict === "Good entry"))}.`);
    if (h.swing.length) L.push(`Swing setups: ${mk(h.swing)}.`);
    if (h.reactions?.length) L.push(`Results reactions: ${h.reactions.map((x) => `${x.ticker} ${sign(x.pct)}`).join(", ")}.`);
    if (h.earnings.length) L.push(`Earnings this week: ${h.earnings.map((e) => `${e.ticker} (${e.days === 0 ? "today" : `${e.days}d`})`).join(", ")}.`);
  }
  return L.join("\n");
}

// " Japan · Nikkei 225 in a bear market (-20.6%)." for markets 10%+ off their high.
function worldTags(world) {
  const t = (world?.markets || []).filter((m) => m.tag).map((m) => `${m.name} in a ${m.tag.toLowerCase()} (${m.drawdownPct.toFixed(1)}%)`);
  return t.length ? ` ${t.join("; ")}.` : "";
}

function digestBody({ reg, fg, sp, ftse, vix, world, coreFund, ctxLine, research, trackRecord, scan, priceAlerts, planItems, book }) {
  const L = [];
  const tr = trackRecord?.summary;
  L.push(`Regime: ${reg.label}. ${reg.action}`);
  if (sp) L.push(`S&P 500 week ${sign(sp.weekPct)}, month ${sign(sp.monthPct)}, ${sp.drawdownPct.toFixed(1)}% off high.`);
  if (ftse) L.push(`FTSE 100 week ${sign(ftse.weekPct)}, month ${sign(ftse.monthPct)}, ${ftse.drawdownPct.toFixed(1)}% off high.`);
  if (fg) L.push(`F&G ${fg.score} (${ratingFor(fg.score)}), a week ago ${fg.comparisons?.week ?? "n/a"}, a month ago ${fg.comparisons?.month ?? "n/a"}.${vix ? ` VIX ${vix.level.toFixed(1)}.` : ""}`);
  const cf = coreFundLine(coreFund);
  if (cf) L.push(cf);
  const pw = picksWeekLine(planItems ?? {});
  if (pw) L.push(pw);
  if (world) L.push(`World: ${world.label} (${world.score >= 0 ? "+" : ""}${world.score}); ${world.above200}/${world.markets.length} markets above their 200-day.${worldTags(world)}`);
  if (ctxLine) L.push(ctxLine);
  const h = researchHighlights(research);
  if (h) {
    if (h.longTerm.length) L.push(`Top long-term: ${h.longTerm.slice(0, 3).map((x) => `${x.ticker} ${x.score} (${x.verdict.toLowerCase()})`).join(", ")}.`);
    if (h.swing.length) L.push(`Swing setups: ${h.swing.map((x) => x.ticker).join(", ")}.`);
    if (h.movers?.length) L.push(`Biggest score changes this week: ${h.movers.map((x) => `${x.ticker} ${x.change > 0 ? "+" : ""}${x.change} (now ${x.score})`).join(", ")}.`);
    if (h.earnings.length) L.push(`Earnings next 7 days: ${h.earnings.map((e) => `${e.ticker} ${e.date}`).join(", ")}.`);
  }
  const sl = scanLine(scan, null);
  if (sl) L.push(sl);
  const pal = alertDigestLine(priceAlerts ?? []);
  if (pal) L.push(pal);
  L.push(rebalanceDigestLine());
  const bl = bookLine(book);
  if (bl) L.push(bl);
  if (tr?.total && !tr.scored) L.push(`Track record: ${tr.total} signal${tr.total === 1 ? "" : "s"} logged since ${tr.since}; too early to judge (each needs a week of trading).`);
  if (tr?.scored) L.push(`Track record: ${tr.total} signal${tr.total === 1 ? "" : "s"} since ${tr.since}; ${tr.hitRate}% went the right way ${tr.basis === "m1" ? "after a month" : "so far"}, ${tr.beatIdx ?? tr.beatSp}% beat their home index.`);
  const kindLine = tr?.total ? digestKindLine(trackRecord.byKind) : null;
  if (kindLine) L.push(kindLine);
  return L.join("\n");
}

main().catch((e) => { console.error("Monitor failed:", e); process.exit(1); });
