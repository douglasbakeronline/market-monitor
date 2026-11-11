// Drift book (paper), 11 Nov 2026: Douglas asked to develop the swing side.
// A second paper book beside Claude's swing book, run on a different signal:
// the swing lab's post-results drift (a +4% day on 3x normal volume, the one
// published effect that came close in the backtest; src/swingLab.js). It is
// built from the live volume-shock log (history/swing-lab.json), so it has no
// survivorship bias and nothing in it was fitted to past data.
// Rules, written down before it first ran:
//   - Up moves only. Buy at the next open (the log's entry), hold 20 sessions
//     (the backtest's holding period), no stop, costs as the lab (US 0.3%,
//     UK 0.5% round trip, already in the log's returns).
//   - At most 4 open, a quarter of the book each at entry.
//   - Same-day choice: confirmed results days first, then the bigger volume
//     multiple, then the bigger move.
// Notional £10,000; percentages are what matter. Display only.
import { r2 } from "./util.js";

export const DBOOK = { equity0: 10000, maxOpen: 4 };

const rank = (a, b) => (b.results ? 1 : 0) - (a.results ? 1 : 0) || (b.volX ?? 0) - (a.volX ?? 0) || (b.movePct ?? 0) - (a.movePct ?? 0) || (a.symbol < b.symbol ? -1 : 1);

export function driftBook(log = [], opts = {}) {
  const o = { ...DBOOK, ...opts };
  const order = o.order ?? ((xs) => xs.sort(rank));
  const up = log.filter((t) => (t.kind ?? "up") === "up");
  const live = up.filter((t) => t.status !== "pending" && t.entryDate && t.entry > 0);
  const done = (t) => t.net20 != null && t.date20;
  const byEntry = Object.groupBy(live, (t) => t.entryDate);
  const dates = [...new Set([...live.map((t) => t.entryDate), ...live.filter(done).map((t) => t.date20)])].sort();
  let equity = o.equity0;
  const held = [], taken = [], curve = [];
  const settle = (h, d) => {
    const pnl = h.pos * (h.t.net20 / 100);
    equity += pnl;
    Object.assign(h.rec, { pnl: r2(pnl), netPct: h.t.net20, idxPct: h.t.idx20 ?? null, exitDate: h.t.date20 });
    curve.push({ date: d, equity: r2(equity) });
  };
  for (const d of dates) {
    for (let k = held.length - 1; k >= 0; k--) if (done(held[k].t) && held[k].t.date20 <= d) { settle(held[k], d); held.splice(k, 1); }
    for (const t of order([...(byEntry[d] ?? [])])) {
      if (held.length >= o.maxOpen) continue;
      const pos = equity / o.maxOpen;
      const rec = { id: t.id, symbol: t.symbol, ticker: t.ticker, name: t.name, market: t.market, entryDate: t.entryDate, entry: t.entry,
        movePct: t.movePct, volX: t.volX, results: !!t.results, pos: r2(pos) };
      held.push({ t, pos, rec }); taken.push(rec);
    }
  }
  const open = held.map((h) => ({ ...h.rec, sessions: h.t.sessions ?? 0, openPct: h.t.netPct ?? 0, openPnl: r2(h.pos * ((h.t.netPct ?? 0) / 100)) }));
  const value = equity + open.reduce((a, x) => a + x.openPnl, 0);
  const pending = up.filter((t) => t.status === "pending").sort(rank);
  const free = Math.max(0, o.maxOpen - open.length);
  const orders = pending.slice(0, free).map((t) => ({ symbol: t.symbol, ticker: t.ticker, name: t.name, market: t.market, signalDate: t.signalDate, signalPrice: t.signalPrice, movePct: t.movePct, volX: t.volX, results: !!t.results }));
  const closed = taken.filter((x) => x.pnl != null);
  return {
    start: taken[0]?.entryDate ?? null, equity0: o.equity0, realised: r2(equity), value: r2(value), returnPct: r2((value / o.equity0 - 1) * 100),
    open, orders, waiting: Math.max(0, pending.length - orders.length), closed: closed.length,
    winRate: closed.length ? Math.round((closed.filter((x) => x.pnl > 0).length / closed.length) * 100) : null,
    avgNetPct: closed.length ? r2(closed.reduce((a, x) => a + x.netPct, 0) / closed.length) : null,
    recent: closed.slice(-8).reverse(), curve, rules: o, paused: false,
  };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Same book choosing at random among each day's signals.
export function randomDriftBooks(log = [], { runs = 200, seed = 11, ...opts } = {}) {
  const rand = rng(seed);
  const shuffle = (xs) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
  const mine = driftBook(log, opts).returnPct;
  const rs = Array.from({ length: runs }, () => driftBook(log, { ...opts, order: shuffle }).returnPct).sort((a, b) => a - b);
  return { runs, mine, median: rs[Math.floor(rs.length / 2)] ?? null, p10: rs[Math.floor(rs.length * 0.1)] ?? null, p90: rs[Math.floor(rs.length * 0.9)] ?? null,
    beatShare: rs.length ? Math.round((rs.filter((x) => x < mine).length / rs.length) * 100) : null };
}
