// "Today" (platform review, 12 Nov 2026): the Dashboard opened with market
// context and buried the real-money actions 14 sections down (16,000px). This
// gathers what needs doing from data already on the page, in priority order:
// pot orders for the next open, plan actions due today or tomorrow, results
// tomorrow for list names and pot holdings, and decisions waiting. Each line
// links to the section with the detail. Pure, so it is tested.
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

// d: data.json; today: London date; decisions: number waiting (or null).
export function todayItems(d = {}, today, { decisions = null } = {}) {
  const out = [];
  const pot = d?.shortTerm?.pot;
  if (pot?.paused) out.push({ tone: "sell", text: "Short-term pot paused: 25% below its high. No new trades until it is reviewed.", href: "#stSection" });
  for (const s of pot?.sells ?? []) out.push({ tone: "sell", text: `Sell ${s.ticker} at the next open (short-term pot, exit rule met)`, href: "#stSection" });
  for (const b of pot?.buys ?? []) out.push({ tone: "buy", text: `Buy ${b.ticker} at the next open (short-term pot, ${b.kind === "drift" ? "results drift" : "bounce"})`, href: "#stSection" });
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
