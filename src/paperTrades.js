// Swing paper-trading log. Every clean swing "Setup" from the nightly index
// scan becomes a paper trade under the agreed swing rules, then is scored
// automatically on later daily bars:
//   entry  = next session's open (signals come after the close)
//   stop   = the setup's stop (2x ATR, with the volatility floor)
//   target = entry + 2R, where R = entry - stop
//   exit   = stop, target, or the close after 20 sessions
// When a bar touches both stop and target we assume the stop hit first.
// The swing pot should only be trusted with real money if this log shows
// positive expectancy over a decent sample.
import { r1, r2 } from "./util.js";

export const RULES = { rMultiple: 2, maxSessions: 20 };

// Add new trades for today's setups (one open trade per symbol).
export function addSetups(log, setups, date) {
  const open = new Set(log.filter((t) => t.status === "pending" || t.status === "open").map((t) => t.symbol));
  const out = log.slice();
  for (const s of setups) {
    if (open.has(s.symbol) || !s.stop || !(s.price > s.stop)) continue;
    out.push({ id: `${date}:${s.symbol}`, symbol: s.symbol, ticker: s.ticker, name: s.name, market: s.market, currency: s.currency,
      signalDate: date, signalPrice: s.price, stop: s.stop, score: s.score, ...(s.why?.length ? { why: s.why } : {}), status: "pending" });
    open.add(s.symbol);
  }
  return out;
}

// Advance one trade through the bars after its signal date.
export function updateTrade(trade, rows) {
  if (!rows?.length || trade.status === "closed" || trade.status === "void") return trade;
  const t = { ...trade };
  const after = rows.filter((r) => r.date > t.signalDate);
  if (!after.length) return t;
  if (t.status === "pending") {
    const first = after[0];
    if (!(first.open > t.stop)) return { ...t, status: "void", entryDate: first.date, note: "Opened below the stop: no trade." };
    t.status = "open"; t.entryDate = first.date; t.entry = r2(first.open);
    t.risk = t.entry - t.stop; t.target = r2(t.entry + RULES.rMultiple * t.risk);
  }
  const bars = after.filter((r) => r.date >= t.entryDate);
  let i = 0;
  for (const b of bars) {
    i++;
    const gapDown = i > 1 && b.open <= t.stop, gapUp = i > 1 && b.open >= t.target;
    if (gapDown || b.low <= t.stop) return close(t, b.date, gapDown ? b.open : t.stop, i, "stop");
    if (gapUp || b.high >= t.target) return close(t, b.date, gapUp ? b.open : t.target, i, "target");
    if (i >= RULES.maxSessions) return close(t, b.date, b.close, i, "time");
  }
  const last = bars.at(-1);
  return { ...t, sessions: i, lastPrice: r2(last.close), lastDate: last.date, openR: r2((last.close - t.entry) / t.risk) };
}

function close(t, date, price, sessions, reason) {
  return { ...t, status: "closed", exitDate: date, exit: r2(price), sessions, reason, r: r2((price - t.entry) / t.risk),
    retPct: r1(((price - t.entry) / t.entry) * 100), lastPrice: undefined, openR: undefined };
}

// Headline numbers. Expectancy = average R per closed trade.
export function summarise(log) {
  const closed = log.filter((t) => t.status === "closed");
  const open = log.filter((t) => t.status === "open" || t.status === "pending");
  const stat = (xs) => {
    if (!xs.length) return { closed: 0, wins: 0, winRate: null, avgR: null, totalR: 0 };
    const wins = xs.filter((t) => t.r > 0).length, total = xs.reduce((a, t) => a + t.r, 0);
    return { closed: xs.length, wins, winRate: Math.round((wins / xs.length) * 100), avgR: r2(total / xs.length), totalR: r1(total) };
  };
  const since = log.length ? log.map((t) => t.signalDate).sort()[0] : null;
  return { since, total: log.filter((t) => t.status !== "void").length, open: open.length, ...stat(closed),
    us: stat(closed.filter((t) => t.market === "US")), uk: stat(closed.filter((t) => t.market === "UK")),
    reasons: { target: closed.filter((t) => t.reason === "target").length, stop: closed.filter((t) => t.reason === "stop").length, time: closed.filter((t) => t.reason === "time").length } };
}

// Research-page view: closed trades filtered by market and minimum setup
// score, with gross and after-cost R and a cumulative R curve by exit date.
// costR is passed in (src/swingRetune.js) to keep this module dependency-free.
export function paperView(log, { market = "all", minScore = 0, costR = () => 0 } = {}) {
  const keep = (t) => t.status !== "void" && (market === "all" || t.market === market) && (t.score ?? 0) >= minScore;
  const xs = log.filter(keep);
  const closed = xs.filter((t) => t.status === "closed" && t.r != null)
    .sort((a, b) => (a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : a.id < b.id ? -1 : 1));
  let g = 0, n = 0;
  const byDate = new Map();
  for (const t of closed) {
    g += t.r; n += t.r - costR(t);
    byDate.set(t.exitDate, { date: t.exitDate, r: r2(g), net: r2(n) });
  }
  const wins = closed.filter((t) => t.r > 0).length;
  const reasons = { target: 0, stop: 0, time: 0 };
  for (const t of closed) if (t.reason in reasons) reasons[t.reason]++;
  return {
    trades: xs.length, open: xs.filter((t) => t.status === "open" || t.status === "pending").length,
    closed: closed.length, wins, winRate: closed.length ? Math.round((wins / closed.length) * 100) : null,
    avgR: closed.length ? r2(g / closed.length) : null, avgNetR: closed.length ? r2(n / closed.length) : null,
    totalR: r2(g), totalNetR: r2(n), reasons,
    curve: [...byDate.values()],
    recent: closed.slice(-8).reverse(),
  };
}
