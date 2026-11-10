// Claude's swing book (paper): what a real swing pot would hold if it followed
// the agreed funded-swing rules (docs/STRATEGY-NOTES.md) and took the best
// clean setups. Built each night from the swing paper log (src/paperTrades.js),
// so every trade's entry, stop, 2R target and 20-session exit are the log's.
//   - At most 4 open positions; a new setup is taken only if a slot is free.
//   - Choice: highest swing score first; ties go to the smaller stop distance.
//   - Risk 2% of the book per trade (0.2% of a whole portfolio), with no single
//     position above 25% of the book.
//   - Costs per trade as in src/swingRetune.js (US 0.3%, UK 0.5% round trip).
//   - Pause, and take no new trades, if the book falls 25% below its start.
// Notional £10,000 start: percentages are what matter. Display only.

export const BOOK = { equity0: 10000, maxOpen: 4, riskPct: 2, maxPosPct: 25, pausePct: 25 };

const r2 = (x) => Math.round(x * 100) / 100;
const rank = (a, b) => (b.score ?? 0) - (a.score ?? 0) || ((a.stopPct ?? 99) - (b.stopPct ?? 99)) || (a.symbol < b.symbol ? -1 : 1);

// log: paper trades; costR(t): cost in R; opts as BOOK. Pending trades (entry at
// the next open) are the book's orders for the next session if slots are free.
export function swingBook(log = [], costR = () => 0, opts = {}) {
  const o = { ...BOOK, ...opts };
  const live = log.filter((t) => (t.status === "open" || t.status === "closed") && t.entryDate && t.entry > 0 && t.risk > 0);
  const byEntry = Object.groupBy(live, (t) => t.entryDate);
  const dates = [...new Set([...live.map((t) => t.entryDate), ...live.filter((t) => t.status === "closed").map((t) => t.exitDate)])].sort();
  let equity = o.equity0, paused = false, skipped = 0;
  const held = [], taken = [], curve = [];
  for (const d of dates) {
    // Exits first: a slot freed today can take today's entry.
    for (let k = held.length - 1; k >= 0; k--) {
      const h = held[k];
      if (h.t.status === "closed" && h.t.exitDate <= d) {
        const pnl = h.riskAmt * (h.t.r - costR(h.t));
        equity += pnl;
        Object.assign(h.rec, { pnl: r2(pnl), netR: r2(h.t.r - costR(h.t)), exitDate: h.t.exitDate, exit: h.t.exit, reason: h.t.reason });
        held.splice(k, 1);
        curve.push({ date: d, equity: r2(equity) });
      }
    }
    if (equity <= o.equity0 * (1 - o.pausePct / 100)) paused = true;
    const cands = (byEntry[d] ?? []).map((t) => ({ ...t, stopPct: (t.risk / t.entry) * 100 })).sort(rank);
    for (const t of cands) {
      if (paused || held.length >= o.maxOpen) { skipped++; continue; }
      let riskAmt = equity * (o.riskPct / 100);
      const posValue = riskAmt * (t.entry / t.risk);
      if (posValue > equity * (o.maxPosPct / 100)) riskAmt = equity * (o.maxPosPct / 100) * (t.risk / t.entry);
      const rec = { id: t.id, symbol: t.symbol, ticker: t.ticker, name: t.name, market: t.market, currency: t.currency, score: t.score,
        entryDate: t.entryDate, entry: t.entry, stop: t.stop, target: t.target, riskAmt: r2(riskAmt), posValue: r2(riskAmt * (t.entry / t.risk)) };
      held.push({ t, riskAmt, rec });
      taken.push(rec);
      // A trade that opened and closed the same day is settled at once.
      if (t.status === "closed" && t.exitDate === d) {
        const pnl = riskAmt * (t.r - costR(t));
        equity += pnl;
        Object.assign(rec, { pnl: r2(pnl), netR: r2(t.r - costR(t)), exitDate: t.exitDate, exit: t.exit, reason: t.reason });
        held.pop();
        curve.push({ date: d, equity: r2(equity) });
      }
    }
  }
  // Mark open positions to the latest close (before the exit cost).
  const open = held.map((h) => ({ ...h.rec, lastPrice: h.t.lastPrice ?? null, lastDate: h.t.lastDate ?? null, openR: h.t.openR ?? 0, openPnl: r2(h.riskAmt * (h.t.openR ?? 0)) }));
  const unreal = open.reduce((a, x) => a + x.openPnl, 0);
  // Orders for the next session: today's clean setups, best first, into free slots.
  const pending = log.filter((t) => t.status === "pending").map((t) => ({ ...t, stopPct: t.signalPrice ? ((t.signalPrice - t.stop) / t.signalPrice) * 100 : null })).sort(rank);
  const free = paused ? 0 : Math.max(0, o.maxOpen - open.length);
  const orders = pending.slice(0, free).map((t) => ({ symbol: t.symbol, ticker: t.ticker, name: t.name, market: t.market, currency: t.currency, score: t.score, signalDate: t.signalDate, signalPrice: t.signalPrice, stop: t.stop, stopPct: t.stopPct == null ? null : r2(t.stopPct) }));
  const closed = taken.filter((x) => x.pnl != null);
  const wins = closed.filter((x) => x.pnl > 0).length;
  const value = equity + unreal;
  return {
    start: taken[0]?.entryDate ?? null, equity0: o.equity0, realised: r2(equity), value: r2(value), returnPct: r2((value / o.equity0 - 1) * 100),
    paused, open, orders, waiting: Math.max(0, pending.length - orders.length), skipped,
    closed: closed.length, winRate: closed.length ? Math.round((wins / closed.length) * 100) : null,
    avgNetR: closed.length ? r2(closed.reduce((a, x) => a + x.netR, 0) / closed.length) : null,
    recent: closed.slice(-8).reverse(), curve, rules: o,
  };
}

// Sunday digest line, e.g. "Swing book (paper): -2.4% since 2 Nov (S&P 500
// +1.1%); 4 open, 2 closed, average -1.05R after costs."
export function bookLine(b) {
  if (!b?.start) return null;
  const pct = (x) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
  const d = new Date(b.start + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `Swing book (paper): ${pct(b.returnPct)} since ${d}${b.sp?.pct != null ? ` (S&P 500 ${pct(b.sp.pct)})` : ""}; ${b.open.length} open, ${b.closed} closed${b.avgNetR != null ? `, average ${b.avgNetR > 0 ? "+" : ""}${b.avgNetR}R after costs` : ""}${b.paused ? "; paused after a 25% fall" : ""}.`;
}
