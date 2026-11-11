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
// opts.order: how same-day candidates are ranked (default: best score first);
// randomBooks() passes a shuffle to see what luck alone would have done.
export function swingBook(log = [], costR = () => 0, opts = {}) {
  const o = { ...BOOK, ...opts };
  const order = o.order ?? ((xs) => xs.sort(rank));
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
    const cands = order((byEntry[d] ?? []).map((t) => ({ ...t, stopPct: (t.risk / t.entry) * 100 })));
    for (const t of cands) {
      if (paused || held.length >= o.maxOpen) { skipped++; continue; }
      let riskAmt = equity * (o.riskPct / 100);
      const posValue = riskAmt * (t.entry / t.risk);
      if (posValue > equity * (o.maxPosPct / 100)) riskAmt = equity * (o.maxPosPct / 100) * (t.risk / t.entry);
      const rec = { id: t.id, symbol: t.symbol, ticker: t.ticker, name: t.name, market: t.market, currency: t.currency, score: t.score,
        entryDate: t.entryDate, entry: t.entry, stop: t.stop, target: t.target, riskAmt: r2(riskAmt), posValue: r2(riskAmt * (t.entry / t.risk)), ...(t.why ? { why: t.why } : {}) };
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
  const orders = pending.slice(0, free).map((t) => ({ symbol: t.symbol, ticker: t.ticker, name: t.name, market: t.market, currency: t.currency, score: t.score, signalDate: t.signalDate, signalPrice: t.signalPrice, stop: t.stop, stopPct: t.stopPct == null ? null : r2(t.stopPct), ...(t.why ? { why: t.why } : {}) }));
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

// Seeded PRNG (mulberry32) for repeatable random books.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The same book, same rules and same days, but choosing among each day's
// setups at random: how often did luck do better than "best score first"?
export function randomBooks(log = [], costR = () => 0, { runs = 200, seed = 7, ...opts } = {}) {
  const rand = rng(seed);
  const shuffle = (xs) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
  const mine = swingBook(log, costR, opts).returnPct;
  const rs = Array.from({ length: runs }, () => swingBook(log, costR, { ...opts, order: shuffle }).returnPct).sort((a, b) => a - b);
  const median = rs.length ? rs[Math.floor(rs.length / 2)] : null;
  const beat = rs.length ? Math.round((rs.filter((x) => x < mine).length / rs.length) * 100) : null;
  return { runs, mine, median, p10: rs[Math.floor(rs.length * 0.1)] ?? null, p90: rs[Math.floor(rs.length * 0.9)] ?? null, beatShare: beat };
}

// Daily % change of a benchmark from the day before the book's start, for the
// card's comparison line. rows: [{date, close}] oldest first.
export function benchSeries(rows = [], start) {
  if (!start) return [];
  const before = [...rows].reverse().find((r) => r.date < start);
  if (!before) return [];
  return rows.filter((r) => r.date >= start).map((r) => ({ date: r.date, pct: r2((r.close / before.close - 1) * 100) }));
}

// What changed in the book since `seen` (ids of orders and closed trades
// already announced): one push line, or null. First run (seen null) is silent.
export function bookNews(b, seen) {
  if (!b?.start) return { line: null, seen };
  const orderIds = b.orders.map((o) => `${o.signalDate}:${o.symbol}`), closedIds = b.recent.map((x) => x.id);
  const next = { orders: orderIds, closed: [...new Set([...(seen?.closed ?? []), ...closedIds])].slice(-60) };
  if (!seen) return { line: null, seen: next };
  const newOrders = b.orders.filter((o) => !(seen.orders ?? []).includes(`${o.signalDate}:${o.symbol}`));
  const newClosed = b.recent.filter((x) => !(seen.closed ?? []).includes(x.id));
  if (!newOrders.length && !newClosed.length) return { line: null, seen: next };
  const parts = [];
  if (newOrders.length) parts.push(`buy at the next open: ${newOrders.map((o) => `${o.ticker} (stop ${o.stopPct}% below)`).join(", ")}`);
  if (newClosed.length) parts.push(`closed: ${newClosed.map((x) => `${x.ticker} ${x.netR > 0 ? "+" : ""}${x.netR}R (${{ stop: "stopped", target: "target", time: "20 sessions" }[x.reason] ?? x.reason})`).join(", ")}`);
  const d = new Date(b.start + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return { line: `${parts.join("; ")}. Book ${b.returnPct > 0 ? "+" : ""}${b.returnPct}% since ${d}.`, seen: next, newOrders, newClosed };
}

// The swing-trade push (paper): the book's new orders with entry, stop and
// target, and its closed trades. The book already picks the strongest clean
// setups (best score first, at most 4 open), so these are the few trades a
// funded swing pot would take, not every setup. Returns [] when nothing is new.
export function swingTradeAlerts(news, b) {
  if (!news?.line || !b) return [];
  const fmt = (v, c) => (c === "GBp" ? `${Math.round(v)}p` : `${c === "EUR" ? "\u20ac" : c === "USD" ? "$" : ""}${v >= 100 ? v.toFixed(1) : v.toFixed(2)}`);
  const sign = (x) => `${x > 0 ? "+" : ""}${x}`;
  const book = `Book ${sign(b.returnPct)}% since ${new Date(b.start + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}${b.sp?.pct != null ? ` (S&P ${sign(b.sp.pct)}%)` : ""}; ${b.open?.length ?? 0} open.`;
  const out = [];
  if (news.newOrders?.length) {
    const lines = news.newOrders.map((o) => {
      const tgt = o.signalPrice > o.stop ? o.signalPrice + 2 * (o.signalPrice - o.stop) : null;
      return `${o.ticker} (${o.name ?? o.ticker}, ${o.market}): buy at the next open (last close ${fmt(o.signalPrice, o.currency)}). Stop ${fmt(o.stop, o.currency)}${o.stopPct != null ? ` (${Math.abs(o.stopPct)}% below)` : ""}; target about ${tgt ? fmt(tgt, o.currency) : "2R"} (2x the risk), or out after 20 sessions.${o.why?.length ? ` Why: ${o.why.join(", ")}.` : ""}`;
    });
    out.push({ kind: "swing", priority: "high", tags: "chart_with_upwards_trend", title: `Swing trade (paper): buy ${news.newOrders.map((o) => o.ticker).join(", ")}`,
      body: [...lines, ...(news.newOrders.some((o) => o.market !== "US") ? ["London and European names open before this alert lands (08:15); the paper book takes the opening price."] : []), `Paper only: the plan keeps swing at 0% until you fund a swing pot. Risk 2% of the book per trade. ${book}`].join("\n") });
  }
  if (news.newClosed?.length) {
    out.push({ kind: "swing", priority: "default", tags: "checkered_flag", title: `Swing trade (paper): closed ${news.newClosed.map((x) => x.ticker).join(", ")}`,
      body: [...news.newClosed.map((x) => `${x.ticker}: ${sign(x.netR)}R after costs (${{ stop: "stop hit", target: "target hit", time: "20 sessions up" }[x.reason] ?? x.reason}).`), `Paper only. ${book}`].join("\n") });
  }
  return out;
}

// Proposed bar for real money (11 Nov, Douglas asked to develop swing; the bar
// itself needs his OK, as funding swing is a rule change). A paper book
// qualifies only when ALL hold, judged on live trades, after costs:
//   - at least 30 closed trades (fewer is mostly luck);
//   - average at least +0.2R per trade (0.2R a trade at 2% risk is about
//     +0.4% of the book a trade, enough to survive real slippage);
//   - better than 80% of the random-choice books (the ranking adds something);
//   - ahead of the S&P 500 over the same days (else the core does it better);
//   - worst fall from a peak under 15% (well clear of the 25% pause).
export const FUND_BAR = { minClosed: 30, minAvgR: 0.2, minBeat: 80, maxFall: 15 };

// Worst peak-to-trough fall of a book in %, from its curve and today's value.
export function maxFallPct(b) {
  const pts = [b.equity0, ...(b.curve ?? []).map((c) => c.equity), b.value].filter((x) => x > 0);
  let peak = 0, worst = 0;
  for (const v of pts) { peak = Math.max(peak, v); worst = Math.min(worst, v / peak - 1); }
  return r2(-worst * 100);
}

// Checklist against FUND_BAR. avgKey/avgUnit let the drift book (returns in
// %) use the same bar with its own average: { avg, minAvg, unit }.
export function fundingCheck(b, { bar = FUND_BAR, avg = b?.avgNetR, minAvg = bar.minAvgR, unit = "R" } = {}) {
  if (!b?.start) return null;
  const fall = maxFallPct(b), fmtAvg = (x) => `${x > 0 ? "+" : ""}${x}${unit === "R" ? "R" : "%"}`;
  const checks = [
    { key: "closed", label: `${bar.minClosed}+ closed trades`, now: `${b.closed}`, ok: b.closed >= bar.minClosed },
    { key: "avg", label: `Average ${fmtAvg(minAvg)} or better after costs`, now: avg == null ? "none yet" : fmtAvg(avg), ok: avg != null && avg >= minAvg },
    { key: "luck", label: `Beats ${bar.minBeat}% of random-choice books`, now: b.random?.beatShare == null ? "n/a" : `${b.random.beatShare}%`, ok: (b.random?.beatShare ?? -1) >= bar.minBeat },
    { key: "sp", label: "Ahead of the S&P 500 over the same days", now: b.sp?.pct == null ? "n/a" : `${b.returnPct > 0 ? "+" : ""}${b.returnPct}% vs ${b.sp.pct > 0 ? "+" : ""}${b.sp.pct}%`, ok: b.sp?.pct != null && b.returnPct > b.sp.pct },
    { key: "fall", label: `Worst fall under ${bar.maxFall}%`, now: `${fall}%`, ok: fall < bar.maxFall && !b.paused },
  ];
  const passed = checks.filter((c) => c.ok).length;
  return { checks, passed, total: checks.length, met: passed === checks.length,
    line: passed === checks.length ? "Meets the proposed bar for real money: worth a decision." : `${passed} of ${checks.length} checks met${b.closed < bar.minClosed ? `; needs ${bar.minClosed - b.closed} more closed trades before it can be judged` : ""}.` };
}
