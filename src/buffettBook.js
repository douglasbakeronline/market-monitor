// Buffett book (paper), from December 2026. Douglas (11 Nov): "lean into
// Warren Buffett's principles on picking companies and investment", and
// track everything on paper. The lens (src/buffett.js) cannot be backtested
// (Yahoo keeps only four years of accounts), so it is tested forward here.
// Rules, written down before it first ran:
//   - Universe: every company the nightly scan assesses (S&P 500, FTSE 100,
//     Euro Stoxx 50, Nasdaq 100 extras).
//   - Review on the first session of each month. Orders are filled at the
//     next session's open (the decision uses that night's close).
//   - Buy only "Buffett buy zone" companies (every quality test passed, price
//     25%+ below the cautious intrinsic value), largest margin of safety
//     first, at most 10 holdings and 3 per sector, 10% of the book each.
//   - Sell only when the business fails a quality test on fresh accounts, or
//     the price runs 50%+ above intrinsic value. Never for a price fall: "our
//     favourite holding period is forever".
//   - Unspent money waits as cash (0%). Trading 212 costs: US and Europe 0.3%,
//     UK 0.5% round trip, half on each side. Price returns in each stock's own
//     currency (dividends and currency moves left out, which flatters
//     neither side much against a price index).
// Notional £10,000; percentages are what matter.
import { r2 } from "./util.js";
import { gicsSector } from "./sectorValue.js";

// Sector cap on the GICS sector, so UK "Banks" and US "Financials" count together.
const sec = (x) => gicsSector(x) ?? x ?? "Other";

export const BBOOK = { start: "2026-12", equity0: 10000, maxHold: 10, perSector: 3, size: 0.10, minBuy: 0.05, sellAbove: -0.5 };
const COST = { US: 0.003, UK: 0.005, EU: 0.003 };
const half = (m) => (COST[m] ?? 0.003) / 2;

export const newBuffettBook = () => ({ rules: BBOOK, cash: BBOOK.equity0, positions: [], pending: [], lastReview: null, trades: [], curve: [], value: BBOOK.equity0 });

export function reviewDue(b, date, start = BBOOK.start) {
  const m = date?.slice(0, 7);
  return !!m && m >= start && (b.lastReview == null || m > b.lastReview);
}

const posValue = (p) => p.amount * (p.last / p.entry);
export const bookValue = (b) => r2(b.cash + b.positions.reduce((a, p) => a + posValue(p), 0));

// Monthly review: queue sells and buys. lens: {symbol: {verdict, quality, mos, ticker, name, sector, market}}.
export function review(b, lens, date, o = BBOOK) {
  const value = bookValue(b), pending = [];
  let cash = b.cash, slots = o.maxHold - b.positions.length;
  for (const p of b.positions) {
    const l = lens[p.symbol];
    if (!l) continue; // not assessed tonight: keep
    const why = l.quality === false && l.verdict?.startsWith("Fails") ? `business failed a test (${l.verdict.toLowerCase()})` : l.mos != null && l.mos <= o.sellAbove ? `price ${Math.round(-l.mos * 100)}% above intrinsic value` : null;
    if (why) { pending.push({ side: "sell", symbol: p.symbol, ticker: p.ticker, market: p.market, date, why }); cash += posValue(p); slots++; }
  }
  const held = new Set(b.positions.map((p) => p.symbol));
  const sectors = {};
  for (const p of b.positions) if (!pending.some((x) => x.symbol === p.symbol)) sectors[sec(p.sector)] = (sectors[sec(p.sector)] ?? 0) + 1;
  const cands = Object.entries(lens).filter(([s, l]) => !held.has(s) && l.verdict === "Buffett buy zone" && l.mos != null)
    .sort((a, c) => c[1].mos - a[1].mos || (a[0] < c[0] ? -1 : 1));
  for (const [s, l] of cands) {
    if (slots <= 0) break;
    if ((sectors[sec(l.sector)] ?? 0) >= o.perSector) continue;
    const amount = Math.min(value * o.size, cash);
    if (amount < value * o.minBuy) break;
    pending.push({ side: "buy", symbol: s, ticker: l.ticker, name: l.name, market: l.market, sector: l.sector, date, amount: r2(amount), mos: l.mos });
    cash -= amount; slots--; sectors[sec(l.sector)] = (sectors[sec(l.sector)] ?? 0) + 1;
  }
  return { ...b, pending, lastReview: date.slice(0, 7) };
}

// Fill queued orders at the first open after the order date. rows: {symbol: [{date, open, close}]}.
export function fillOrders(b, rows) {
  let cash = b.cash;
  const positions = b.positions.slice(), trades = b.trades.slice(), left = [];
  for (const o of b.pending) {
    const bar = (rows[o.symbol] ?? []).find((r) => r.date > o.date && r.open > 0);
    if (!bar) { left.push(o); continue; }
    if (o.side === "sell") {
      const k = positions.findIndex((p) => p.symbol === o.symbol);
      if (k < 0) continue;
      const p = positions[k], gross = p.amount * (bar.open / p.entry), fee = gross * half(p.market);
      cash += gross - fee;
      trades.push({ side: "sell", symbol: p.symbol, ticker: p.ticker, date: bar.date, price: bar.open, why: o.why, pct: r2(((gross - fee) / p.cost - 1) * 100), held: p.entryDate });
      positions.splice(k, 1);
    } else {
      const amt = Math.min(o.amount, cash);
      if (amt <= 0) continue;
      const fee = amt * half(o.market);
      cash -= amt;
      positions.push({ symbol: o.symbol, ticker: o.ticker, name: o.name, market: o.market, sector: o.sector, entryDate: bar.date, entry: bar.open, amount: r2(amt - fee), cost: r2(amt), last: bar.open, lastDate: bar.date, mos: o.mos });
      trades.push({ side: "buy", symbol: o.symbol, ticker: o.ticker, date: bar.date, price: bar.open, amount: r2(amt), mos: o.mos });
    }
  }
  return { ...b, cash: r2(cash), positions, pending: left, trades: trades.slice(-200) };
}

// Mark to the latest closes and add a curve point.
export function markBuffett(b, rows, date) {
  const positions = b.positions.map((p) => { const r = rows[p.symbol]?.at(-1); return r?.close > 0 && r.date >= p.lastDate ? { ...p, last: r.close, lastDate: r.date } : p; });
  const nb = { ...b, positions };
  const value = bookValue(nb);
  const started = positions.length > 0 || b.trades.length > 0;
  return { ...nb, value, curve: started ? [...b.curve.filter((x) => x.date !== date), { date, value }].slice(-800) : b.curve };
}

export function buffettSummary(b) {
  const start = b.trades[0]?.date ?? null;
  return {
    start, value: b.value, returnPct: start ? r2((b.value / b.rules.equity0 - 1) * 100) : null, cash: b.cash,
    holdings: b.positions.map((p) => ({ ticker: p.ticker, name: p.name, market: p.market, sector: p.sector, since: p.entryDate, pct: r2(((posValue(p)) / p.cost - 1) * 100), weight: b.value > 0 ? r2((posValue(p) / b.value) * 100) : null, mos: p.mos })),
    pending: b.pending, sold: b.trades.filter((t) => t.side === "sell").slice(-8).reverse(),
  };
}
