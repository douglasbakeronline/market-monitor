// The agreed investing plan (docs/STRATEGY-NOTES.md), as data the monitor can
// check against. Percentages and dates only: no amounts, no holdings.
// Douglas places every trade; this only says what the plan says is due.
import { addDays } from "./util.js";
import { resultsEstimate } from "./research.js";

export const PLAN = {
  pots: [
    { key: "core", name: "Core index (VWRP)", target: 70, note: "Never sold on a signal. Includes the 10% first meant for swing (5 Nov)." },
    { key: "reserve", name: "Dip reserve (cash)", target: 15, note: "A third at each confirmed buy tier." },
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
  // The core fund's largest holdings the scan covers, with their weight in
  // VWRP (FTSE All-World; Alphabet's two share classes combined). Their
  // published results dates join Key dates automatically. Display only: the
  // core is never bought or sold on a signal. Refresh the weights now and then.
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
  ],
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
    : !good ? `Not a good entry today: hold off this tranche.`
    : ed != null ? `Next results in ${ed} days.`
    : recentlyReported ? `Reported ${dayLabel(last)}; next results not due for weeks.`
    : estNote ?? "No results date known; check before buying.";
  return { ...pick, resultsEstimate: est, ticker: item.ticker ?? pick.symbol.replace(/\.L$/, ""), verdict, score, earningsDays: ed, lastEarnings: last, price: item.price ?? null, currency: item.currency ?? null, ok, reason };
}

// What does the plan say for the coming week? `today` is a London date.
export function copilot({ today, sp, ftse, items = {}, plan = PLAN }) {
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
  const actions = plan.schedule.filter((s) => s.date >= today && s.date <= end).map((s) => {
    const a = { ...s, inDays: days(today, s.date) };
    if (s.kind === "picks") {
      const okN = picks.filter((p) => p.ok).length;
      a.status = okN === picks.length ? "go" : okN ? "partial" : "hold";
      const wait = picks.filter((p) => !p.ok).map((p) => p.ticker);
      a.note = `${okN} of ${picks.length} picks pass the check today${wait.length ? ` (${wait.join(", ")} ${wait.length === 1 ? "waits" : "wait"})` : ""}.`;
    } else a.status = "due";
    return a;
  });
  if (pullback.triggered) actions.unshift({ date: today, kind: "pullback", inDays: 0, status: "go",
    title: "Pullback rule: bring the next core purchase forward",
    detail: `${pullback.index} is ${Math.abs(pullback.drawdown).toFixed(1)}% below its high (rule: ${Math.abs(plan.pullbackPct)}% or more). The plan says make the core purchase due ${dayLabel(pullback.nextCore.date)} now.` });

  const upcoming = plan.schedule.filter((s) => s.date > end).slice(0, 2).map((s) => ({ ...s, inDays: days(today, s.date) }));
  const auto = coreHoldingDates(items, today, plan);
  const covered = new Set(auto.map((d) => d.symbol));
  const dates = plan.keyDates.filter((k) => k.date >= today && days(today, k.date) <= 21 && !covered.has(k.symbol))
    .map((k) => ({ ...k, inDays: days(today, k.date) }))
    .concat(auto).sort((a, b) => a.date.localeCompare(b.date) || (b.weight ?? 0) - (a.weight ?? 0));
  const headline = actions.length
    ? `${actions.length} plan action${actions.length > 1 ? "s" : ""} this week`
    : `Nothing due this week${upcoming[0] ? `; next: ${upcoming[0].title.charAt(0).toLowerCase() + upcoming[0].title.slice(1)} in ${upcoming[0].inDays} days` : ""}`;
  return { today, headline, actions, upcoming, pullback, picks, dates, pots: plan.pots };
}

// Published results dates of the core fund's biggest holdings in the next
// `horizon` days (Yahoo's date via the scan or research items; estimates are
// left out so only confirmed dates show).
export function coreHoldingDates(items = {}, today, plan = PLAN, horizon = 21) {
  if (!today) return [];
  return (plan.coreHoldings ?? []).flatMap((h) => {
    const d = items[h.symbol]?.earnings?.date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today) return [];
    const inDays = days(today, d);
    if (inDays > horizon) return [];
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
  if (cp.dates.length) L.push(`Key dates: ${cp.dates.slice(0, 3).map((d) => `${d.title} (${dayLabel(d.date)})`).join("; ")}.`);
  return L;
}
