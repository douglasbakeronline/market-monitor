// The agreed investing plan (docs/STRATEGY-NOTES.md), as data the monitor can
// check against. Percentages and dates only: no amounts, no holdings.
// Douglas places every trade; this only says what the plan says is due.
import { addDays } from "./util.js";

export const PLAN = {
  pots: [
    { key: "core", name: "Core index (VWRP)", target: 60, note: "Never sold on a signal." },
    { key: "reserve", name: "Dip reserve (cash)", target: 15, note: "A third at each confirmed buy tier." },
    { key: "picks", name: "Long-term picks", target: 15, note: "Five companies, up to 3% each, 1% tranches." },
    { key: "swing", name: "Swing", target: 10, note: "Max 4 trades, stop at entry, 2R or 20 sessions." },
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
    { date: "2026-11-16", kind: "core", title: "Second core purchase (VWRP)", detail: "The rest of this tax year's core money." },
    { date: "2026-11-16", kind: "swing", title: "Swing alerts start (US only)", detail: "Max 4 open trades, stop order placed at entry, exit at 2R or 20 sessions." },
    // Can't come forward: the money can't enter the ISA before the new allowance.
    { date: "2027-04-06", kind: "core", pullback: false, title: "New ISA allowance: pay in savings, resume monthly core", detail: "Move the money held in easy-access savings into the ISA." },
  ],
  keyDates: [
    { date: "2026-11-03", title: "US midterm elections" },
    { date: "2026-11-04", title: "CF Industries results, a bench pick" },
    { date: "2026-11-05", title: "Bank of England rate decision" },
    { date: "2026-11-17", title: "Nvidia results, about 5% of VWRP" },
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
  const ed = item.earnings?.days ?? null;
  const resultsSoon = ed != null && ed >= 0 && ed <= PLAN.pickNoResultsDays;
  // No next date published yet: if the latest results came out recently, the
  // next ones are about a quarter away, so the 7-day rule can't bite.
  const last = item.lastEarnings ?? null;
  const sinceLast = ed == null && last && today ? days(last, today) : null;
  const recentlyReported = sinceLast != null && sinceLast >= 0 && sinceLast <= PLAN.recentResultsDays;
  const good = verdict === "Good entry";
  const ok = good && !resultsSoon;
  const reason = resultsSoon ? `Results ${ed === 0 ? "today" : ed === 1 ? "tomorrow" : `in ${ed} days`}: wait until after.`
    : !good ? `Not a good entry today: hold off this tranche.`
    : ed != null ? `Next results in ${ed} days.`
    : recentlyReported ? `Reported ${dayLabel(last)}; next results not due for weeks.`
    : "No results date known; check before buying.";
  return { ...pick, ticker: item.ticker ?? pick.symbol.replace(/\.L$/, ""), verdict, score, earningsDays: ed, lastEarnings: last, price: item.price ?? null, currency: item.currency ?? null, ok, reason };
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
  const dates = plan.keyDates.filter((k) => k.date >= today && days(today, k.date) <= 21).map((k) => ({ ...k, inDays: days(today, k.date) }));
  const headline = actions.length
    ? `${actions.length} plan action${actions.length > 1 ? "s" : ""} this week`
    : `Nothing due this week${upcoming[0] ? `; next: ${upcoming[0].title.charAt(0).toLowerCase() + upcoming[0].title.slice(1)} in ${upcoming[0].inDays} days` : ""}`;
  return { today, headline, actions, upcoming, pullback, picks, dates, pots: plan.pots };
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
