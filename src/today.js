// "Today" (platform review, 12 Nov 2026): the Dashboard opened with market
// context and buried the real-money actions 14 sections down (16,000px). This
// gathers what needs doing from data already on the page, in priority order:
// pot orders for the next open, plan actions due today or tomorrow, results
// tomorrow for list names and pot holdings, and decisions waiting. Each line
// links to the section with the detail. Pure, so it is tested.
import { orderTiming } from "./sessions.js";
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
const dm = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

// d: data.json; today: London date; decisions: number waiting (or null);
// now: the current instant. With it (13 Nov), pot orders whose open has
// already passed are folded into one reminder to log them instead of reading
// "at the next open" until the evening scan replaces them.
export function todayItems(d = {}, today, { decisions = null, now = null } = {}) {
  const out = [];
  const pot = d?.shortTerm?.pot;
  if (pot?.paused) out.push({ tone: "sell", text: "Short-term pot paused: 25% below its high. No new trades until it is reviewed.", href: "#stSection" });
  const from = pot?.rules?.today ?? d?.shortTerm?.date ?? null;
  const passed = [];
  const when = (o, date, side) => {
    const t = now ? orderTiming(date ?? from, o.market, now) : null;
    if (t?.state === "passed") { passed.push({ ticker: o.ticker, side, due: t.due }); return null; }
    return t?.state === "today" ? "at today's open" : t && t.due !== addDay(today) ? `at the ${dm(t.due)} open` : "at the next open";
  };
  for (const s of pot?.sells ?? []) { const w = when(s, s.exitDate, "sell"); if (w) out.push({ tone: "sell", text: `Sell ${s.ticker} ${w} (short-term pot, exit rule met)`, href: "#stSection" }); }
  for (const b of pot?.buys ?? []) { const w = when(b, b.signalDate, "buy"); if (w) out.push({ tone: "buy", text: `Buy ${b.ticker} ${w} (short-term pot, ${b.kind === "drift" ? "results drift" : "bounce"})`, href: "#stSection" }); }
  if (passed.length) {
    const dues = [...new Set(passed.map((x) => x.due))].sort(), last = dues.at(-1);
    const open = dues.length === 1 && last === today ? "today's open" : `the ${dm(last)} open`;
    const list = passed.map((x) => `${x.side === "sell" ? "sell " : ""}${x.ticker}`);
    out.push({ tone: "info", text: `Short-term pot orders were due at ${open}: ${list.join(", ")}. Log them if you placed them; the next list follows the evening scan.`, href: "#tlSection" });
  }
  for (const a of d?.copilot?.actions ?? []) {
    if (a.status === "done" || a.inDays == null || a.inDays > 1) continue;
    out.push({ tone: "plan", text: `${a.inDays <= 0 ? "Today" : "Tomorrow"}: ${a.title}`, href: "#planSection" });
  }
  const rp = d?.resultsPreview;
  for (const r of rp?.focus ?? []) {
    const n = dayDiff(r.date, today);
    if (n !== 1 && !(r.held && n >= 0 && n <= 7)) continue;
    const when = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
    out.push({ tone: r.held ? "watch" : "info", text: `${r.ticker} reports ${when}${r.typical != null ? `; it usually moves ±${r.typical.toFixed(1)}%` : ""}${r.held ? " (the pot holds it)" : ""}`, href: "#raSection" });
  }
  if (decisions) out.push({ tone: "info", text: `${decisions} decision${decisions === 1 ? "" : "s"} waiting on you`, href: "#decSection" });
  return out;
}

const addDay = (date) => (date ? new Date(Date.parse(`${date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10) : null);
