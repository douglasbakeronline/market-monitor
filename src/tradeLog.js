// Trade log: pure helpers shared by the Dashboard (browser) and the tests.
// Trades are kept in the viewer's browser only (localStorage); nothing here
// touches the network or the repo. Each trade records the plan rule that
// triggered it, so the Dashboard can show plan adherence.

// Rules a trade can cite. `pot` is the default pot the trade lands in.
export const RULES = [
  { key: "core", label: "Scheduled core purchase", pot: "core", kinds: ["core"] },
  { key: "pullback", label: "Pullback rule (core brought forward)", pot: "core", kinds: ["core"] },
  { key: "tranche", label: "Pick tranche", pot: "picks", kinds: ["picks"] },
  { key: "dip", label: "Dip tier (reserve deployed)", pot: "core", kinds: [] },
  { key: "swing", label: "Swing setup", pot: "swing", kinds: [] },
  { key: "reinvest", label: "Dividend or proceeds reinvested", pot: "core", kinds: [] },
  { key: "rebalance", label: "Rebalance to target weights", pot: "core", kinds: [] },
  { key: "other", label: "Other (off-plan)", pot: "core", kinds: [] },
];
export const POT_KEYS = ["core", "reserve", "picks", "swing"];
const RULE = Object.fromEntries(RULES.map((r) => [r.key, r]));

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// How far a trade may sit from its scheduled date and still count for it.
// Before: the pullback rule can bring a core date forward by up to two weeks.
export const MATCH = { before: 14, after: 7, onTime: 1 };

// Clean one trade from the form or an imported file. Returns { trade } or { error }.
export function normaliseTrade(raw = {}, today = null) {
  const date = String(raw.date ?? "").trim();
  if (!YMD.test(date) || Number.isNaN(Date.parse(date))) return { error: "Date must be YYYY-MM-DD." };
  if (today && date > today) return { error: "Date is in the future." };
  const action = raw.action === "sell" ? "sell" : raw.action === "buy" ? "buy" : null;
  if (!action) return { error: "Choose buy or sell." };
  const rule = RULE[raw.rule] ? raw.rule : null;
  if (!rule) return { error: "Choose the rule behind the trade." };
  const pot = POT_KEYS.includes(raw.pot) ? raw.pot : RULE[rule].pot;
  const ticker = String(raw.ticker ?? "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  if (!ticker) return { error: "Add the ticker (e.g. VWRP)." };
  const amt = raw.amount === "" || raw.amount == null ? null : parseFloat(String(raw.amount).replace(/[£,\s]/g, ""));
  if (amt != null && !(Number.isFinite(amt) && amt > 0)) return { error: "Amount must be a positive number, or blank." };
  const note = String(raw.note ?? "").trim().slice(0, 140);
  const id = raw.id && typeof raw.id === "string" ? raw.id : `${date}-${ticker}-${Math.random().toString(36).slice(2, 8)}`;
  return { trade: { id, date, action, pot, rule, ticker, amount: amt == null ? null : Math.round(amt * 100) / 100, note } };
}

export const sortTrades = (ts) => [...ts].sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));

// Net money put into each pot (buys minus sells), from trades with an amount.
export function potTotals(trades) {
  const out = Object.fromEntries(POT_KEYS.map((k) => [k, 0]));
  let counted = 0;
  for (const t of trades) {
    if (t.amount == null || !(t.pot in out)) continue;
    out[t.pot] += t.action === "sell" ? -t.amount : t.amount;
    counted++;
  }
  return { ...out, counted, total: POT_KEYS.reduce((a, k) => a + out[k], 0) };
}

// Plan adherence: each scheduled core or picks action up to `today`, matched to
// a logged trade citing that rule. A trade can satisfy only one scheduled item.
export function adherence(schedule, trades, today) {
  const due = schedule.filter((s) => (s.kind === "core" || s.kind === "picks") && s.date <= today);
  const used = new Set();
  const items = due.map((s) => {
    const fits = trades.filter((t) => t.action === "buy" && RULE[t.rule]?.kinds.includes(s.kind) && !used.has(t.id))
      .map((t) => ({ t, gap: days(s.date, t.date) }))
      .filter(({ gap }) => gap >= -MATCH.before && gap <= MATCH.after);
    // Pick tranches: every tranche in the window belongs to this date.
    const take = s.kind === "picks" ? fits : fits.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap)).slice(0, 1);
    take.forEach(({ t }) => used.add(t.id));
    const first = take.length ? Math.min(...take.map((x) => x.gap)) : null;
    const pending = !take.length && days(s.date, today) <= MATCH.after;
    const status = !take.length ? (pending ? "pending" : "missed") : first <= MATCH.onTime ? "on-time" : "late";
    return { date: s.date, kind: s.kind, title: s.title, status, trades: take.map(({ t }) => t.id), tickers: [...new Set(take.map(({ t }) => t.ticker))] };
  });
  const counted = items.filter((i) => i.status !== "pending");
  const onTime = counted.filter((i) => i.status === "on-time").length;
  const offPlan = trades.filter((t) => t.rule === "other").length;
  const headline = !counted.length ? (items.length ? "First scheduled action still open" : "No scheduled actions yet")
    : `${onTime} of ${counted.length} scheduled action${counted.length > 1 ? "s" : ""} done on time`;
  return { items, onTime, counted: counted.length, offPlan, headline };
}

// Parse an imported backup: an array of trades, or { trades: [...] }.
export function parseImport(text, today = null) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: "Not a valid JSON file." }; }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.trades) ? data.trades : null;
  if (!arr) return { error: "No trades found in the file." };
  const trades = [], skipped = [];
  for (const raw of arr) { const r = normaliseTrade(raw, today); r.trade ? trades.push(r.trade) : skipped.push(r.error); }
  return { trades, skipped: skipped.length };
}
