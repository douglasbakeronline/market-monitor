// The agreed investing plan (docs/STRATEGY-NOTES.md), as data the monitor can
// check against. Percentages and dates only: no amounts, no holdings.
// Douglas places every trade; this only says what the plan says is due.
import { addDays } from "./util.js";
import { resultsEstimate } from "./research.js";
import { SELL_KINDS } from "./sellSignals.js";

export const PLAN = {
  pots: [
    { key: "core", name: "Core index (VWRP)", target: 70, note: "Never sold on a signal. Includes the 10% first meant for swing (5 Nov)." },
    { key: "reserve", name: "Dip reserve (cash)", target: 15, note: "A third at each confirmed buy tier; a sixth drips into the core each quiet month (10 Nov)." },
    { key: "picks", name: "Long-term picks", target: 15, note: "Five companies, up to 3% each, 1% tranches." },
    { key: "swing", name: "Swing (paper only)", target: 0, note: "No real trades: the 5 Nov retune found no edge after costs." },
  ],
  picks: [
    { symbol: "HSBA.L", name: "HSBC", sector: "Banks" },
    { symbol: "META", name: "Meta", sector: "Communication services" },
    { symbol: "NEM", name: "Newmont", sector: "Gold mining" },
    { symbol: "STZ", name: "Constellation Brands", sector: "Consumer staples" },
    { symbol: "VICI", name: "VICI Properties", sector: "Property (REIT)" },
  ],
  bench: ["SCHW", "CF", "LLOY.L", "NWG.L", "AMZN", "GLEN.L"],
  // Scheduled actions. kind "core" dates are what the pullback rule pulls forward.
  schedule: [
    { date: "2026-11-02", kind: "core", title: "First core purchase (VWRP)", detail: "Half of this tax year's core money." },
    { date: "2026-11-02", kind: "picks", title: "First tranche of each pick", detail: "About a third of each position, only where the pick is still a good entry with no results within 7 days." },
    { date: "2026-11-16", kind: "core", title: "Second core purchase (VWRP)", detail: "The rest of this tax year's core money, plus the 10% first set aside for swing." },
    { date: "2026-11-16", kind: "swing", title: "Swing stays on paper (no real trades)", detail: "Retune tested 5 Nov: no stricter setup beat random entry after costs. Swing stays paper-traded; its 10% goes into the core." },
    // Can't come forward: the money can't enter the ISA before the new allowance.
    { date: "2027-04-06", kind: "core", pullback: false, title: "New ISA allowance: pay in savings, resume monthly core", detail: "Move the money held in easy-access savings into the ISA." },
  ],
  keyDates: [
    { date: "2026-11-03", title: "US midterm elections" },
    { date: "2026-11-04", title: "CF Industries results, a bench pick" },
    { date: "2026-11-05", title: "Bank of England rate decision" },
    { date: "2026-11-17", title: "Nvidia results, about 5% of VWRP", symbol: "NVDA" },
  ],
  // The core fund's 20 largest holdings, with their weight in VWRP (FTSE
  // All-World; Alphabet's two share classes combined). Their published results
  // dates join Key dates automatically. `extra`: not in the index scan, so the
  // scan fetches a quote for the date only (TSMC via its US listing, which
  // reports with Taiwan). Display only: the core is never bought or sold on a
  // signal. Refresh the weights each quarter (stockanalysis.com VWRP holdings).
  coreHoldingsAsOf: "31 Jul 2026",
  coreHoldings: [
    { symbol: "NVDA", name: "Nvidia", weight: 4.5 },
    { symbol: "AAPL", name: "Apple", weight: 4.3 },
    { symbol: "MSFT", name: "Microsoft", weight: 3.3 },
    { symbol: "GOOGL", name: "Alphabet", weight: 3.6 },
    { symbol: "AMZN", name: "Amazon", weight: 2.5 },
    { symbol: "AVGO", name: "Broadcom", weight: 1.7 },
    { symbol: "META", name: "Meta", weight: 1.2 },
    { symbol: "JPM", name: "JPMorgan Chase", weight: 0.9 },
    { symbol: "MU", name: "Micron", weight: 0.9 },
    { symbol: "LLY", name: "Eli Lilly", weight: 0.9 },
    { symbol: "TSLA", name: "Tesla", weight: 0.9 },
    { symbol: "AMD", name: "AMD", weight: 0.7 },
    { symbol: "TSM", name: "TSMC", weight: 1.7, extra: true },
    { symbol: "005930.KS", name: "Samsung Electronics", weight: 0.8, extra: true },
    { symbol: "BRK-B", name: "Berkshire Hathaway", weight: 0.7 },
    { symbol: "000660.KS", name: "SK hynix", weight: 0.6, extra: true },
    { symbol: "XOM", name: "ExxonMobil", weight: 0.6 },
    { symbol: "ASML.AS", name: "ASML", weight: 0.6 },
    { symbol: "JNJ", name: "Johnson & Johnson", weight: 0.6 },
  ],
  coreSmallDays: 7, // holdings under 1% of VWRP show only in the last week, to keep Key dates short
  // Unused dip reserve drips into the core (agreed 10 Nov 2026, research log
  // 5 and 6 Nov): on the first Monday of each month, a sixth of the reserve
  // cash moves into VWRP unless a buy tier was confirmed in the 30 days before.
  reserveDrip: { start: "2026-12-07", fraction: 6, quietDays: 30 },
  pullbackPct: -5,   // core purchase comes forward if an index is this far off its high
  pickNoResultsDays: 7,
  recentResultsDays: 60, // latest results this recent means the next are weeks away (quarterly reporters)
};

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// Pick status from research items (or scan items). A tranche is "ok" when the
// pick is a long-term good entry and has no results due within 7 days.
export function pickStatus(pick, item, today = null) {
  if (!item) return { ...pick, ticker: pick.symbol.replace(/\.L$/, ""), ok: null, reason: "No data yet." };
  const verdict = item.longTerm?.verdict ?? null, score = item.longTerm?.score ?? null;
  // A results date in the past (Yahoo keeps it for a day or so after the
  // release) means the results are out: treat it as the latest results date.
  const rawEd = item.earnings?.days ?? null;
  const ed = rawEd != null && rawEd < 0 ? null : rawEd;
  const resultsSoon = ed != null && ed >= 0 && ed <= PLAN.pickNoResultsDays;
  // No next date published yet: if the latest results came out recently, the
  // next ones are about a quarter away, so the 7-day rule can't bite.
  const last = rawEd != null && rawEd < 0 && item.earnings?.date ? item.earnings.date : item.lastEarnings ?? null;
  const sinceLast = ed == null && last && today ? days(last, today) : null;
  const recentlyReported = sinceLast != null && sinceLast >= 0 && sinceLast <= PLAN.recentResultsDays;
  const good = verdict === "Good entry";
  const ok = good && !resultsSoon;
  // Nothing published and not reported recently: estimate from the cadence
  // (display only; `ok` is unchanged).
  const est = ed == null && !recentlyReported && today ? item.resultsEstimate ?? resultsEstimate(last, today, { uk: /\.L$/.test(pick.symbol) }) : null;
  const estNote = est ? (est.days <= PLAN.pickNoResultsDays + 7
    ? `No results date published; ${est.days < 0 ? "results may just be out" : `results usually due around ${dayLabel(est.date)}`} (estimated${est.stale ? ", latest date looks stale" : ""}): check before buying.`
    : `No results date published; next estimated ${est.basis === "uk-earliest" ? "no earlier than" : "around"} ${dayLabel(est.date)}${est.stale ? " (latest date looks stale)" : ""}.`) : null;
  const reason = resultsSoon ? `Results ${ed === 0 ? "today" : ed === 1 ? "tomorrow" : `in ${ed} days`}: wait until after.`
    : !good ? `Not a good entry today${item.longTerm?.gaps?.length ? ` (${item.longTerm.gaps.join("; ")})` : ""}: hold off this tranche.`
    : ed != null ? `Next results in ${ed} days.`
    : recentlyReported ? `Reported ${dayLabel(last)}; next results not due for weeks.`
    : estNote ?? "No results date known; check before buying.";
  return { ...pick, resultsEstimate: est, ticker: item.ticker ?? pick.symbol.replace(/\.L$/, ""), verdict, score, change: item.change?.lt ?? null, gaps: item.longTerm?.gaps ?? [], exit: item.exit ?? null, earningsDays: ed, lastEarnings: last, price: item.price ?? null, currency: item.currency ?? null, ok, reason };
}

// Reserve drip dates (first Monday of each month from plan.reserveDrip.start)
// between `from` and `to`, each paused when a confirmed buy tier (tierDates,
// YYYY-MM-DD) came within quietDays before it.
export function dripSchedule(from, to, tierDates = [], plan = PLAN) {
  const d = plan.reserveDrip;
  if (!d || !from || !to) return [];
  const out = [];
  const start = from > d.start ? from : d.start;
  let y = +start.slice(0, 4), m = +start.slice(5, 7) - 1;
  for (let k = 0; k < 120; k++, m++) {
    const first = new Date(Date.UTC(y, m, 1));
    const date = new Date(Date.UTC(y, m, 1 + ((8 - first.getUTCDay()) % 7))).toISOString().slice(0, 10);
    if (date > to) break;
    if (date < start) continue;
    const tier = tierDates.filter((t) => t <= date && days(t, date) <= d.quietDays).sort().at(-1) ?? null;
    out.push({ date, kind: "drip", paused: !!tier, tier,
      title: tier ? "Reserve drip paused" : "Reserve drip: a sixth of the dip reserve into VWRP",
      detail: tier ? `A buy tier was confirmed on ${dayLabel(tier)}, within ${d.quietDays} days: no drip this month.` : `Move a sixth (1/${d.fraction}) of the dip reserve cash into the core. Unused reserve drips in each quiet month (agreed 10 Nov); new money still sets 15% aside for it.` });
  }
  return out;
}

// A pick has reported and the market has reacted (research item lastResults,
// close before to close after): one line for the research alert, once per
// results date. seen = the results date already announced (undefined on the
// first run, which records silently).
export function pickResultsLine(it, seen, plan = PLAN) {
  const lr = it?.lastResults;
  if (!lr || lr.pending || lr.pct == null || !plan.picks.some((p) => p.symbol === it.symbol)) return null;
  if (seen === undefined || seen === lr.date) return null;
  const lt = it.longTerm ?? {};
  const why = lt.verdict !== "Good entry" && lt.gaps?.length ? ` (${lt.gaps[0]})` : "";
  return `${it.ticker} (a pick) reported ${dayLabel(lr.date)}: ${lr.pct >= 0 ? "+" : ""}${lr.pct.toFixed(1)}% from the close before to the close after. Long-term now ${lt.verdict ?? "n/a"}${lt.score != null ? ` ${lt.score}` : ""}${why}.`;
}

// Weekly digest: each pick's week and where it stands, e.g.
// "Your picks this week: HSBA +2.5% (Good entry 73), META -1.2% (Fair 77)...".
export function picksWeekLine(items = {}, plan = PLAN) {
  const parts = plan.picks.map((p) => {
    const it = items[p.symbol];
    if (!it) return null;
    const w = it.perf?.week;
    const lt = it.longTerm;
    return `${it.ticker ?? p.symbol} ${w == null ? "n/a" : `${w >= 0 ? "+" : ""}${w.toFixed(1)}%`}${lt?.verdict ? ` (${lt.verdict}${lt.score != null ? ` ${lt.score}` : ""})` : ""}`;
  }).filter(Boolean);
  return parts.length ? `Your picks this week: ${parts.join(", ")}.` : null;
}

// A pick shows a sell or risk signal today: one line for the research alert.
// study: data/sell-study.json (byKind verdicts), so the line says whether that
// signal has meant anything in our test.
export function pickSellLine(it, study = null, plan = PLAN) {
  const kinds = it?.exit?.kinds ?? [];
  if (!kinds.length || !plan.picks.some((p) => p.symbol === it.symbol)) return null;
  const v = (k) => study?.all?.byKind?.[k]?.verdict;
  const tested = kinds.map((k) => (v(k) === "useful" ? "has preceded weaker returns in our test" : v(k) === "opposite" ? "has preceded stronger returns, not weaker, in our test" : v(k) ? "showed no reliable edge in our test" : null)).filter(Boolean);
  return `${it.ticker} (a pick): ${kinds.map((k) => SELL_KINDS[k]?.label.toLowerCase() ?? k).join(", ")}${tested.length ? `; ${tested[0]}` : ""}. Picks have no sell rule except the 5% ceiling; display only.`;
}

// The bench (replacement candidates): verdict and how close each is, best first.
export function benchStatus(items = {}, plan = PLAN) {
  const rank = (b) => (b.verdict === "Good entry" ? 0 : b.near ? 1 : b.verdict === "Fair" ? 2 : 3);
  return (plan.bench ?? []).map((symbol) => {
    const it = items[symbol], lt = it?.longTerm;
    return { symbol, ticker: it?.ticker ?? symbol.replace(/\.L$/, ""), name: it?.name ?? null, verdict: lt?.verdict ?? null, score: lt?.score ?? null, near: !!lt?.near, gaps: lt?.gaps ?? [] };
  }).sort((a, b) => rank(a) - rank(b) || (b.score ?? -1) - (a.score ?? -1));
}

// The picks' tranche check in one line, e.g. "Picks: HSBA passes; wait: META
// (Entry 69, needs 70), NEM (results in 3 days)."
export function picksLine(picks = []) {
  if (!picks.length) return null;
  const pass = picks.filter((p) => p.ok).map((p) => p.ticker);
  const wait = picks.filter((p) => p.ok === false).map((p) => {
    const why = p.verdict === "Good entry" ? (p.earningsDays != null ? `results in ${p.earningsDays} day${p.earningsDays === 1 ? "" : "s"}` : null) : p.gaps?.[0] ?? null;
    return `${p.ticker}${why ? ` (${why})` : ""}`;
  });
  const sells = picks.filter((p) => p.exit?.kinds?.length).map((p) => `${p.ticker} ${p.exit.kinds.map((k) => SELL_KINDS[k]?.label.toLowerCase() ?? k).join(", ")}`);
  return `Picks: ${[pass.length ? `${pass.join(", ")} ${pass.length === 1 ? "passes" : "pass"}` : "none pass", wait.length ? `wait: ${wait.join(", ")}` : "", sells.length ? `sell signals today: ${sells.join("; ")} (display only)` : ""].filter(Boolean).join("; ")}.`;
}

// One line for the Monday push and the digest.
export function benchLine(bench = []) {
  const good = bench.filter((b) => b.verdict === "Good entry").map((b) => `${b.ticker} ${b.score}`);
  const near = bench.filter((b) => b.verdict !== "Good entry" && b.near).map((b) => `${b.ticker} (${b.gaps[0]})`);
  if (!good.length && !near.length) return null;
  return `Bench: ${[good.length ? `good entry ${good.join(", ")}` : "", near.length ? `close: ${near.join(", ")}` : ""].filter(Boolean).join("; ")}.`;
}

// What does the plan say for the coming week? `today` is a London date.
// tiers: dates of confirmed buy tiers (for the reserve drip).
export function copilot({ today, sp, ftse, items = {}, plan = PLAN, tiers = [] }) {
  const end = addDays(today, 7);
  const nextCore = plan.schedule.find((s) => s.kind === "core" && s.pullback !== false && s.date > today) ?? null;
  const worst = [sp, ftse].filter((m) => m?.drawdownPct != null).sort((a, b) => a.drawdownPct - b.drawdownPct)[0] ?? null;
  const pullback = {
    threshold: plan.pullbackPct,
    nextCore: nextCore ? { date: nextCore.date, title: nextCore.title, inDays: days(today, nextCore.date) } : null,
    index: worst ? worst.name : null, drawdown: worst?.drawdownPct ?? null,
    triggered: !!(nextCore && worst && worst.drawdownPct <= plan.pullbackPct && nextCore.date > today),
  };
  pullback.distance = worst ? Math.round((worst.drawdownPct - plan.pullbackPct) * 10) / 10 : null;

  const picks = plan.picks.map((p) => pickStatus(p, items[p.symbol], today));
  const drips = dripSchedule(today, addDays(today, 400), tiers, plan);
  const sched = [...plan.schedule, ...drips].sort((a, b) => a.date.localeCompare(b.date));
  const actions = sched.filter((s) => s.date >= today && s.date <= end).map((s) => {
    const a = { ...s, inDays: days(today, s.date) };
    if (s.kind === "picks") {
      const okN = picks.filter((p) => p.ok).length;
      a.status = okN === picks.length ? "go" : okN ? "partial" : "hold";
      const wait = picks.filter((p) => !p.ok).map((p) => p.ticker);
      a.note = `${okN} of ${picks.length} picks pass the check today${wait.length ? ` (${wait.join(", ")} ${wait.length === 1 ? "waits" : "wait"})` : ""}.`;
    } else a.status = s.kind === "swing" ? "info" : s.paused ? "hold" : "due";
    return a;
  });
  if (pullback.triggered) actions.unshift({ date: today, kind: "pullback", inDays: 0, status: "go",
    title: "Pullback rule: bring the next core purchase forward",
    detail: `${pullback.index} is ${Math.abs(pullback.drawdown).toFixed(1)}% below its high (rule: ${Math.abs(plan.pullbackPct)}% or more). The plan says make the core purchase due ${dayLabel(pullback.nextCore.date)} now.` });

  const upcoming = sched.filter((s) => s.date > end && !s.paused).slice(0, 2).map((s) => ({ ...s, inDays: days(today, s.date) }));
  const auto = coreHoldingDates(items, today, plan);
  const covered = new Set(auto.map((d) => d.symbol));
  const dates = plan.keyDates.filter((k) => k.date >= today && days(today, k.date) <= 21 && !covered.has(k.symbol))
    .map((k) => ({ ...k, inDays: days(today, k.date) }))
    .concat(auto).sort((a, b) => a.date.localeCompare(b.date) || (b.weight ?? 0) - (a.weight ?? 0));
  // Notes (swing stays on paper) and paused drips are shown but are not things to do.
  const todo = actions.filter((a) => a.status !== "info" && a.status !== "hold" || a.kind === "picks").length;
  const headline = todo
    ? `${todo} plan action${todo > 1 ? "s" : ""} this week`
    : `Nothing due this week${upcoming[0] ? `; next: ${upcoming[0].title.charAt(0).toLowerCase() + upcoming[0].title.slice(1)} in ${upcoming[0].inDays} days` : ""}`;
  return { today, headline, actions, upcoming, pullback, picks, bench: benchStatus(items, plan), dates, pots: plan.pots };
}

// Published results dates of the core fund's biggest holdings in the next
// `horizon` days (Yahoo's date via the scan or research items; estimates are
// left out so only confirmed dates show). Holdings under 1% of the fund show
// only within `plan.coreSmallDays`.
export const coreExtras = (plan = PLAN) => (plan.coreHoldings ?? []).filter((h) => h.extra);

// Scan output for the extras: just the results dates from a batch quote.
export function coreExtraDates(quotes = {}, toFund, earnings, today, plan = PLAN) {
  return coreExtras(plan).flatMap((h) => {
    const f = toFund(quotes[h.symbol]);
    if (!f) return [];
    return [{ symbol: h.symbol, name: h.name, ...earnings(f.nextEarnings, f.lastEarnings, today) }];
  });
}

export function coreHoldingDates(items = {}, today, plan = PLAN, horizon = 21) {
  if (!today) return [];
  return (plan.coreHoldings ?? []).flatMap((h) => {
    const d = items[h.symbol]?.earnings?.date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today) return [];
    const inDays = days(today, d);
    if (inDays > (h.weight < 1 && plan.coreSmallDays ? Math.min(horizon, plan.coreSmallDays) : horizon)) return [];
    const pct = h.weight >= 1 ? `about ${Math.round(h.weight)}%` : `about ${h.weight}%`;
    return [{ date: d, symbol: h.symbol, weight: h.weight, auto: true, inDays,
      title: `${h.name} results, ${pct} of VWRP`, note: `VWRP weights as of ${plan.coreHoldingsAsOf}` }];
  });
}

// Pullback alert: once per scheduled core date, the first time the rule fires.
export function pullbackAlert(cp, state) {
  const p = cp?.pullback;
  if (!p?.triggered) return null;
  if (state.pullbackAlerted === p.nextCore.date) return null;
  state.pullbackAlerted = p.nextCore.date;
  return { kind: "pullback", priority: "high", tags: "shopping_cart", title: `Plan · bring the next core purchase forward`,
    body: `${p.index} is ${Math.abs(p.drawdown).toFixed(1)}% below its 52-week high. Your pullback rule (${Math.abs(p.threshold)}%+ before a scheduled core date) says make the core purchase due ${dayLabel(p.nextCore.date)} now. Core only: picks and the dip reserve follow their own rules.` };
}

const dayLabel = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");

// Short lines for the Monday UK summary and the Sunday digest.
export function copilotLines(cp) {
  if (!cp) return [];
  const L = [];
  for (const a of cp.actions) L.push(`Plan ${dayLabel(a.date)}: ${a.title}${a.note ? `. ${a.note}` : "."}`);
  if (!cp.actions.length) L.push(`Plan: ${cp.headline}.`);
  const p = cp.pullback;
  if (p.nextCore && !p.triggered && p.drawdown != null) L.push(`Pullback rule: ${p.index} ${p.drawdown.toFixed(1)}% off its high (fires at ${p.threshold}%).`);
  const pl = picksLine(cp.picks);
  if (pl) L.push(pl);
  const bl = benchLine(cp.bench);
  if (bl) L.push(bl);
  if (cp.dates.length) L.push(`Key dates: ${cp.dates.slice(0, 3).map((d) => `${d.title} (${dayLabel(d.date)})`).join("; ")}.`);
  return L;
}
