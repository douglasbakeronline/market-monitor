// Trade log: pure helpers shared by the Dashboard (browser) and the tests.
// Trades are kept in the viewer's browser only (localStorage); nothing here
// touches the network or the repo. Each trade records the plan rule that
// triggered it, so the Dashboard can show plan adherence.

// Rules a trade can cite. `pot` is the default pot the trade lands in.
export const RULES = [
  { key: "core", label: "Scheduled core purchase", pot: "core", kinds: ["core"] },
  { key: "pullback", label: "Pullback rule (core brought forward)", pot: "core", kinds: ["core"] },
  { key: "tranche", label: "Pick tranche", pot: "picks", kinds: ["picks"] },
  { key: "dip", label: "Dip tier (reserve deployed)", pot: "core", kinds: ["dip"] },
  { key: "drip", label: "Reserve drip into core (monthly)", pot: "core", kinds: ["drip"] },
  { key: "swing", label: "Short-term pot trade", pot: "swing", kinds: [] },
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
// Dip tiers: the alert comes after the index close, so a trade the same or
// next day is on time; none can come before it (a day's slack for time zones).
const DIP_MATCH = { before: 1, after: 7 };
// The same tier fired by the other index (or again after a short bounce) within
// this many days is the same reserve third, not a new action.
export const DIP_SAME_TIER_DAYS = 60;

// Confirmed buy tiers from the public signal log (history/signals.json, kind
// "buy") as adherence items: one per tier, whichever index fired it first.
export function dipEvents(signals = []) {
  const last = {};
  const out = [];
  for (const s of [...signals].filter((x) => x?.kind === "buy" && YMD.test(x.date ?? "")).sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const m = String(s.label ?? "").match(/\((-\d+)%\)/);
    const tier = m ? m[1] : "?";
    if (last[tier] && days(last[tier], s.date) <= DIP_SAME_TIER_DAYS) continue;
    last[tier] = s.date;
    out.push({ date: s.date, kind: "dip", tier, title: `Dip tier ${tier === "?" ? "" : `${tier.replace("-", "\u2212")}% `}(${s.name ?? s.ticker ?? "index"}): deploy a third of the reserve` });
  }
  return out;
}

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
  // Optional price per share, as Trading 212 shows it (pence for London shares):
  // lets the Dashboard value a pick at today's price instead of at cost.
  const px = raw.price === "" || raw.price == null ? null : parseFloat(String(raw.price).replace(/[£$€,\s]/g, ""));
  if (px != null && !(Number.isFinite(px) && px > 0)) return { error: "Price must be a positive number, or blank." };
  const sh = raw.shares === "" || raw.shares == null ? null : parseFloat(String(raw.shares).replace(/[,\s]/g, ""));
  if (sh != null && !(Number.isFinite(sh) && sh > 0)) return { error: "Shares must be a positive number, or blank." };
  const note = String(raw.note ?? "").trim().slice(0, 140);
  const id = raw.id && typeof raw.id === "string" ? raw.id : `${date}-${ticker}-${Math.random().toString(36).slice(2, 8)}`;
  return { trade: { id, date, action, pot, rule, ticker, amount: amt == null ? null : Math.round(amt * 100) / 100, ...(px != null ? { price: px } : {}), ...(sh != null ? { shares: sh } : {}), note } };
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

// Plan adherence: each scheduled core or picks action up to `today`, plus any
// confirmed dip tier (from dipEvents), matched to a logged trade citing that
// rule. A trade can satisfy only one item.
export function adherence(schedule, trades, today, dips = []) {
  const due = [...schedule.filter((s) => (s.kind === "core" || s.kind === "picks" || (s.kind === "drip" && !s.paused)) && s.date <= today), ...dips.filter((d) => d.date <= today)]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const used = new Set();
  const items = due.map((s) => {
    const fits = trades.filter((t) => t.action === "buy" && RULE[t.rule]?.kinds.includes(s.kind) && !used.has(t.id))
      .map((t) => ({ t, gap: days(s.date, t.date) }))
      .filter(({ gap }) => gap >= -(s.kind === "dip" ? DIP_MATCH.before : MATCH.before) && gap <= MATCH.after);
    // Pick tranches and dip buys: every trade in the window belongs to this date.
    const take = s.kind === "picks" || s.kind === "dip" ? fits : fits.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap)).slice(0, 1);
    take.forEach(({ t }) => used.add(t.id));
    const first = take.length ? Math.min(...take.map((x) => x.gap)) : null;
    const pending = !take.length && days(s.date, today) <= MATCH.after;
    const status = !take.length ? (pending ? "pending" : "missed") : first <= MATCH.onTime ? "on-time" : "late";
    return { date: s.date, kind: s.kind, title: s.title, status, trades: take.map(({ t }) => t.id), tickers: [...new Set(take.map(({ t }) => t.ticker))] };
  });
  const counted = items.filter((i) => i.status !== "pending");
  const onTime = counted.filter((i) => i.status === "on-time").length;
  const offPlan = trades.filter((t) => t.rule === "other").length;
  const headline = !counted.length ? (items.length ? "First plan action still open" : "No plan actions due yet")
    : `${onTime} of ${counted.length} plan action${counted.length > 1 ? "s" : ""} done on time`;
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

// --- Trading 212 CSV export (History, Export CSV) ----------------------------
// Columns used: Action, Time, Ticker, No. of shares, Price / share, Total,
// Currency (Total), ID. Buys and sells become trades (pot and rule guessed from
// the ticker: the core fund, a pick, else "other"); dividends are summed. The
// file stays in the browser; review the guessed rules after importing.

// RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [], f = "", q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(f); f = ""; if (row.some((x) => x !== "")) rows.push(row); row = [];
    } else f += c;
  }
  row.push(f); if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

export const isT212Csv = (text) => /^﻿?"?Action"?,/.test(String(text || ""));

// core: the core fund's ticker(s); picks: pick tickers without ".L".
export function parseT212(text, { core = ["VWRP"], picks = [], today = null } = {}) {
  const rows = parseCsv(text);
  if (!rows.length) return { error: "The file is empty." };
  const head = rows[0].map((h) => h.trim());
  const col = (name) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iA = col("Action"), iT = col("Time"), iK = col("Ticker"), iN = col("No. of shares"), iP = col("Price / share"), iTot = col("Total"), iCur = col("Currency (Total)"), iId = col("ID");
  if (iA < 0 || iT < 0 || iK < 0 || iTot < 0) return { error: "This doesn't look like a Trading 212 export (Action, Time, Ticker and Total columns needed)." };
  // Costs Trading 212 lists per trade: the FX fee on foreign shares and UK
  // stamp duty (column names as in its export; absent columns count as 0).
  const colLike = (re) => head.findIndex((h) => re.test(h) && !/^currency \(/i.test(h));
  const iFx = colLike(/conversion fee/i), iStamp = colLike(/stamp duty/i), iFee = colLike(/^transaction fee/i);
  const costs = { fx: 0, stamp: 0, other: 0, traded: 0, trades: 0 };
  const trades = [], skipped = [], cash = [];
  let dividends = 0, divN = 0, otherCcy = 0;
  const num = (x) => { const n = parseFloat(String(x ?? "").replace(/[,\s]/g, "")); return Number.isFinite(n) ? n : null; };
  for (const r of rows.slice(1)) {
    const action = String(r[iA] || "").toLowerCase(), ticker = String(r[iK] || "").trim().toUpperCase();
    const date = String(r[iT] || "").slice(0, 10), total = num(r[iTot]);
    const ccy = iCur >= 0 ? String(r[iCur] || "").trim().toUpperCase() : "GBP";
    // Cash movements for the ISA tracker (src/isa.js): deposits, withdrawals,
    // dividends and interest, in pounds.
    const cashKind = /dividend/.test(action) ? "dividend" : /^deposit/.test(action) ? "deposit" : /withdraw/.test(action) ? "withdrawal" : /interest/.test(action) ? "interest" : null;
    if (cashKind) {
      if (total != null && ccy === "GBP" && /^\d{4}-\d{2}-\d{2}$/.test(date)) cash.push({ id: iId >= 0 && r[iId] ? `t212c-${String(r[iId]).trim()}` : `t212c-${date}-${cashKind}-${ticker}-${total}`, date, kind: cashKind, amount: Math.abs(total), ...(ticker ? { ticker } : {}) });
      if (cashKind === "dividend" && total != null && ccy === "GBP") { dividends += total; divN++; }
      continue;
    }
    const side = /\bbuy\b/.test(action) ? "buy" : /\bsell\b/.test(action) ? "sell" : null;
    if (!side) continue; // deposits, interest, fees, currency conversions
    if (ccy && ccy !== "GBP") { otherCcy++; continue; }
    if (total != null) {
      costs.traded += Math.abs(total); costs.trades++;
      const fee = (i) => (i >= 0 ? Math.abs(num(r[i]) ?? 0) : 0);
      costs.fx += fee(iFx); costs.stamp += fee(iStamp); costs.other += fee(iFee);
    }
    const pick = picks.includes(ticker.replace(/\.L$/, ""));
    const isCore = core.includes(ticker);
    const rule = isCore ? "core" : pick ? "tranche" : "other";
    const pot = isCore ? "core" : pick ? "picks" : "core";
    const shares = iN >= 0 ? num(r[iN]) : null, price = iP >= 0 ? num(r[iP]) : null;
    const id = iId >= 0 && r[iId] ? `t212-${String(r[iId]).trim()}` : `t212-${date}-${ticker}-${total}`;
    const res = normaliseTrade({ id, date, action: side, pot, rule, ticker, amount: total == null ? "" : Math.abs(total), price: price ?? "", shares: shares ?? "", note: "Trading 212" }, today);
    res.trade ? trades.push(res.trade) : skipped.push(res.error);
  }
  const c2 = (v) => Math.round(v * 100) / 100, paid = costs.fx + costs.stamp + costs.other;
  const costSummary = { fx: c2(costs.fx), stamp: c2(costs.stamp), other: c2(costs.other), total: c2(paid), traded: c2(costs.traded), trades: costs.trades,
    pct: costs.traded > 0 ? Math.round((paid / costs.traded) * 10000) / 100 : null, columns: iFx >= 0 || iStamp >= 0 || iFee >= 0 };
  return { trades, cash, skipped: skipped.length, otherCcy, dividends: Math.round(dividends * 100) / 100, dividendCount: divN, costs: costSummary };
}
