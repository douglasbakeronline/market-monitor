// Short-term pot (REAL MONEY; Douglas, 11 Nov 2026: "Create the pot"; chose
// 10% of the portfolio, both setups, funded from the core). The book of what
// the pot should hold under its rules (docs/STRATEGY-NOTES.md), built from
// the live short-term signal log (history/short-signals.json), so the
// Dashboard and the 08:15 push can say exactly what to buy and sell.
// Rules:
//   - Up to 5 open trades, each a fifth of the pot's value at entry (about
//     2% of the portfolio).
//   - When there are more signals than free slots: results drift first
//     (results days, then the bigger volume multiple), then bounces (most
//     oversold first). Signals that miss a slot are not carried over.
//   - Buy at the next open; exits as tested: drift after 20 sessions, a
//     bounce at the first close above its 5-day average or after 10 sessions.
//     No stop order (the backtest's stop cut drift's edge).
//   - Costs as tested (US 0.3%, UK 0.5% round trip, already in the log).
//   - Pause: no new trades once the pot is 25% below its high; review with
//     Douglas before resuming.
// start: the first signal date counted (11 Nov close, so the first buys are at
// the 12 Nov open). Values are a notional 10,000; percentages are what matter.
import { r2 } from "./util.js";

export const SPOT = { start: "2026-11-11", equity0: 10000, maxOpen: 5, pauseFall: 0.25 };

const rank = (a, b) => (a.kind === b.kind ? 0 : a.kind === "drift" ? -1 : 1)
  || (b.results ? 1 : 0) - (a.results ? 1 : 0) || (b.volX ?? 0) - (a.volX ?? 0) || (a.rsi2 ?? 100) - (b.rsi2 ?? 100) || (a.symbol < b.symbol ? -1 : 1);

// log: history/short-signals.json. opts.today: the latest bar's date (sells are
// the trades whose exit came at that close).
export function shortPot(log = [], opts = {}) {
  const o = { ...SPOT, ...opts };
  const inRange = log.filter((t) => t.signalDate >= o.start);
  const live = inRange.filter((t) => t.status !== "pending" && t.entryDate && t.entry > 0);
  const done = (t) => t.status === "closed" && t.exitDate;
  const byEntry = Object.groupBy(live, (t) => t.entryDate);
  const dates = [...new Set([...live.map((t) => t.entryDate), ...live.filter(done).map((t) => t.exitDate)])].sort();
  let equity = o.equity0, peak = o.equity0, paused = false;
  const held = [], taken = [], curve = [];
  for (const d of dates) {
    for (let k = held.length - 1; k >= 0; k--) {
      const h = held[k];
      if (done(h.t) && h.t.exitDate <= d) {
        const pnl = h.pos * (h.t.netPct / 100);
        equity += pnl; Object.assign(h.rec, { pnl: r2(pnl), netPct: h.t.netPct, vsIdx: h.t.vsIdx ?? null, exitDate: h.t.exitDate, exit: h.t.exit });
        curve.push({ date: d, equity: r2(equity) }); held.splice(k, 1);
      }
    }
    peak = Math.max(peak, equity);
    if (equity <= peak * (1 - o.pauseFall)) paused = true;
    for (const t of [...(byEntry[d] ?? [])].sort(rank)) {
      if (paused || held.length >= o.maxOpen) continue;
      const pos = equity / o.maxOpen;
      const rec = { id: t.id, kind: t.kind, symbol: t.symbol, ticker: t.ticker, name: t.name, market: t.market, entryDate: t.entryDate, entry: t.entry, pos: r2(pos) };
      held.push({ t, pos, rec }); taken.push(rec);
    }
  }
  const open = held.map((h) => ({ ...h.rec, sessions: h.t.sessions ?? 0, openPct: h.t.netPct ?? 0, openPnl: r2(h.pos * ((h.t.netPct ?? 0) / 100)) }));
  const value = equity + open.reduce((a, x) => a + x.openPnl, 0);
  if (value <= peak * (1 - o.pauseFall)) paused = true;
  const pending = inRange.filter((t) => t.status === "pending").sort(rank);
  const free = paused ? 0 : Math.max(0, o.maxOpen - open.length);
  const buys = pending.slice(0, free).map((t) => ({ kind: t.kind, symbol: t.symbol, ticker: t.ticker, name: t.name, market: t.market, signalDate: t.signalDate, signalPrice: t.signalPrice }));
  const closed = taken.filter((x) => x.pnl != null);
  const lastExit = o.today ?? closed.map((x) => x.exitDate).sort().at(-1) ?? null;
  return {
    rules: o, start: taken[0]?.entryDate ?? null, value: r2(value), returnPct: r2((value / o.equity0 - 1) * 100), peak: r2(peak), paused,
    open, buys, skipped: Math.max(0, pending.length - buys.length), free,
    // Trades whose exit came at the latest close: sell at the next open.
    sells: closed.filter((x) => x.exitDate === lastExit).map((x) => ({ kind: x.kind, ticker: x.ticker, name: x.name, market: x.market, exitDate: x.exitDate, netPct: x.netPct })),
    closed: closed.length, winRate: closed.length ? Math.round((closed.filter((x) => x.pnl > 0).length / closed.length) * 100) : null,
    avgNetPct: closed.length ? r2(closed.reduce((a, x) => a + x.netPct, 0) / closed.length) : null,
    recent: closed.slice(-8).reverse(), curve,
  };
}
