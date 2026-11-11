// Momentum book (paper), live from December 2026. Swing lab round 5 passed
// its backtest but is flattered by survivorship (research log 11 Nov), so the
// same rules now run forward on paper, where survivorship cannot help:
//   - Two books, S&P 500 and FTSE 100, a notional £10,000 each.
//   - On the first session of each month (from December 2026), rank today's
//     members by their return from 12 months ago to 1 month ago (month-end
//     closes) and hold the top 10, equal weight, bought and sold at that
//     session's open.
//   - If the index closed below its 10-month average at the month end, hold
//     cash (0%) instead.
//   - Trading 212 costs: US 0.3%, UK 0.5% round trip, half on each pound
//     bought or sold.
// No backfill: the first rebalance is 1 Dec, so nothing here is fitted.
import { r2 } from "./util.js";
import { monthEndCloses } from "./sectorRotation.js";
import { MOM_COST } from "./momentum.js";

export const MBOOK = { start: "2026-12", top: 10, equity0: 10000 };

export function newMomentumBook() {
  const m = () => ({ cash: MBOOK.equity0, positions: [], lastRebalance: null, value: MBOOK.equity0, rebalances: [], curve: [] });
  return { rules: MBOOK, markets: { US: m(), UK: m() } };
}

// Is a rebalance due for a market whose latest session is `date`?
export function rebalanceDue(mk, date, start = MBOOK.start) {
  const month = date?.slice(0, 7);
  return !!month && month >= start && (mk.lastRebalance == null || month > mk.lastRebalance);
}

// Month-end closes before `month` and the open of the first session in `month`.
export function monthView(rows, month) {
  const before = rows.filter((r) => r.date.slice(0, 7) < month);
  const first = rows.find((r) => r.date.slice(0, 7) === month);
  return { ends: monthEndCloses(before), open: first?.open > 0 ? first.open : null, date: first?.date ?? null };
}

// 12-1 momentum from month ends (last 13 needed); null if too short.
export function mom121(ends) {
  if (ends.length < 13) return null;
  const a = ends.at(-13).close, b = ends.at(-2).close;
  return a > 0 && b > 0 ? b / a - 1 : null;
}

// Index trend at the last month end: close >= 10-month average.
export function trendUp(ends) {
  if (ends.length < 10) return null;
  const xs = ends.slice(-10).map((x) => x.close);
  return xs.at(-1) >= xs.reduce((a, v) => a + v, 0) / 10;
}

// Rank candidates [{symbol, ticker, ends, open}] -> top N with an open price.
export function rankMomentum(cands, top = MBOOK.top) {
  return cands.map((c) => ({ ...c, mom: mom121(c.ends) })).filter((c) => c.mom != null && c.open > 0)
    .sort((a, b) => b.mom - a.mom || (a.symbol < b.symbol ? -1 : 1)).slice(0, top);
}

// Rebalance one market at the month's first open. picks: ranked list
// (empty when the trend filter says cash); opens: {symbol: open} for every
// held or picked name (a held name without an open is valued at its last mark).
export function rebalance(mk, { month, date, picks, opens, cost, trend }) {
  const priceOf = (p) => opens[p.symbol] ?? p.last ?? p.entry;
  const value = mk.cash + mk.positions.reduce((a, p) => a + p.shares * priceOf(p), 0);
  const target = picks.length ? value / picks.length : 0;
  const cur = Object.fromEntries(mk.positions.map((p) => [p.symbol, p]));
  let traded = 0;
  const positions = [];
  for (const p of picks) {
    const was = cur[p.symbol] ? cur[p.symbol].shares * priceOf(cur[p.symbol]) : 0;
    traded += Math.abs(target - was);
    positions.push({ symbol: p.symbol, ticker: p.ticker, name: p.name ?? null, mom: r2(p.mom * 100), entryDate: cur[p.symbol]?.entryDate ?? date, entry: cur[p.symbol]?.entry ?? p.open, shares: target / p.open, last: p.open, lastDate: date });
  }
  for (const p of mk.positions) if (!picks.some((x) => x.symbol === p.symbol)) traded += p.shares * priceOf(p);
  const fees = traded * (cost / 2);
  // Fees come out of the new positions pro rata (or cash when out).
  const scale = picks.length ? (value - fees) / value : 1;
  for (const p of positions) p.shares *= scale;
  const cash = picks.length ? 0 : value - fees;
  const sold = mk.positions.filter((p) => !picks.some((x) => x.symbol === p.symbol)).map((p) => ({ ticker: p.ticker, entry: p.entry, exit: priceOf(p), pct: r2((priceOf(p) / p.entry - 1) * 100) }));
  const rb = { month, date, held: positions.map((p) => p.ticker), sold, bought: positions.filter((p) => !cur[p.symbol]).map((p) => p.ticker), trend, turnover: value > 0 ? r2(traded / value) : 0, fees: r2(fees), value: r2(value - fees) };
  return { ...mk, cash: r2(cash), positions, lastRebalance: month, value: r2(value - fees), rebalances: [...mk.rebalances, rb].slice(-36) };
}

// Mark to the latest closes ({symbol: {date, close}}) and add a curve point.
export function markBook(mk, closes, date) {
  const positions = mk.positions.map((p) => { const c = closes[p.symbol]; return c?.close > 0 && c.date >= p.lastDate ? { ...p, last: c.close, lastDate: c.date } : p; });
  const value = r2(mk.cash + positions.reduce((a, p) => a + p.shares * p.last, 0));
  const curve = mk.lastRebalance ? [...mk.curve.filter((x) => x.date !== date), { date, value }].slice(-800) : mk.curve;
  return { ...mk, positions, value, curve };
}

// Summary for the page and the scoreboard.
export function bookSummary(mk, equity0 = MBOOK.equity0) {
  const start = mk.rebalances[0]?.date ?? null;
  return { start, value: mk.value, returnPct: start ? r2((mk.value / equity0 - 1) * 100) : null, holdings: mk.positions.map((p) => ({ ticker: p.ticker, name: p.name, pct: r2((p.last / p.entry - 1) * 100), weight: mk.value > 0 ? r2(((p.shares * p.last) / mk.value) * 100) : null, since: p.entryDate })),
    cash: mk.cash, last: mk.rebalances.at(-1) ?? null };
}

export const momCost = (market) => MOM_COST[market] ?? 0.003;
