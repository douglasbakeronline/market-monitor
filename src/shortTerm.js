// Short-term signals (Douglas, 11 Nov 2026: "a signal fired" for short-term
// opportunities, "on a bounce or whatever"; chose "both, ranked").
// Two setups, exactly as backtested in the swing lab (research log 10 Nov),
// ranked by their evidence. Since 11 Nov (Douglas: "Create the pot") they
// feed a real-money short-term pot, 10% of the portfolio (src/shortPot.js).
//   drift  a +4% day on 3x the previous 50 sessions' volume (usually results);
//          buy the next open, hold 20 sessions. The one setup with an edge
//          over random entry after costs (+0.58 points a trade), but only in
//          6 of 9 years, so it failed the bar.
//   bounce "dip in an uptrend": close above the 200-day average and 2-day RSI
//          under 10; buy the next open, sell at the first close above the
//          5-day average or after 10 sessions. Wins often (61%) but averaged
//          -0.08% a trade after costs: the bounce is smaller than the costs.
// Every signal is logged and closed under its own exit rule, after costs and
// against its home index, so the live record can confirm or overturn the
// backtest. Each alert shows both.
import { sma, rsi } from "./indicators.js";
import { r1, r2 } from "./util.js";
import { COSTS } from "./swingRetune.js";
import { driftToday } from "./swingLab.js";

export const ST = { maxDrift: 5, maxBounce: 5, rsi2Below: 10, bounceMax: 10, driftHold: 20 };
export const ST_LABEL = { drift: "Results drift", bounce: "Bounce in an uptrend" };

// Backtest record from data/swing-lab.json (results without the stop).
export function testedRecord(lab) {
  const pick = (key) => {
    const r = lab?.results?.find((x) => x.key === key && !x.stop);
    return r ? { n: r.signal.n, avg: r.signal.avg, win: r.signal.win, vsIdx: r.signal.vsIdx, random: r.baseline.avg, edge: r.edge, yearsAhead: r.yearsAhead, years: r.yearsCounted } : null;
  };
  return { drift: pick("drift"), bounce: pick("dip") };
}

// "Bounce in an uptrend" on the last bar; null when it does not fire.
export function bounceToday(rows) {
  const n = rows?.length ?? 0;
  if (n < 201) return null;
  const close = rows.map((r) => r.close);
  const s200 = sma(close, 200).at(-1), r2d = rsi(close, 2).at(-1), last = close.at(-1);
  if (!(s200 > 0) || r2d == null || !(last > s200) || !(r2d < ST.rsi2Below)) return null;
  const fall3 = n > 3 ? r1((last / close[n - 4] - 1) * 100) : null;
  return { date: rows.at(-1).date, price: last, rsi2: r1(r2d), vs200: r1((last / s200 - 1) * 100), fall3 };
}

// Tonight's signals across scan items, ranked: drift first (biggest volume
// shock), then bounces (most oversold, then the stronger long-term score).
// items: [{ symbol, ticker, name, market, index, longTerm, lastEarnings, earnings }]
export function shortTermToday(items, rowsBySymbol) {
  const drift = [], bounce = [];
  for (const i of items) {
    const rows = rowsBySymbol[i.symbol];
    if (!rows?.length) continue;
    const base = { symbol: i.symbol, ticker: i.ticker, name: i.name, market: i.market, index: i.index, score: i.longTerm?.score ?? null };
    const d = driftToday(rows);
    if (d && d.kind === "up") {
      const nearResults = !!(i.lastEarnings && Math.abs(Date.parse(d.date) - Date.parse(i.lastEarnings)) <= 3 * 86400000);
      drift.push({ ...base, kind: "drift", date: d.date, price: d.price, movePct: d.movePct, volX: d.volX, results: nearResults });
      continue; // a stock that just jumped is not a dip
    }
    const b = bounceToday(rows);
    // Results within 7 days make a 10-session bounce a bet on the results.
    if (b && !(i.earnings?.days != null && i.earnings.days >= 0 && i.earnings.days <= 7)) bounce.push({ ...base, kind: "bounce", ...b });
  }
  drift.sort((a, b) => b.volX * b.movePct - a.volX * a.movePct);
  bounce.sort((a, b) => a.rsi2 - b.rsi2 || (b.score ?? 0) - (a.score ?? 0));
  return { drift: drift.slice(0, ST.maxDrift), bounce: bounce.slice(0, ST.maxBounce), counts: { drift: drift.length, bounce: bounce.length } };
}

// Live log: one open trade per symbol and kind.
export function addShort(log = [], sigs = []) {
  const open = new Set(log.filter((t) => t.status !== "closed").map((t) => `${t.kind}:${t.symbol}`));
  const out = log.slice();
  for (const s of sigs) {
    const k = `${s.kind}:${s.symbol}`;
    if (open.has(k)) continue;
    out.push({ id: `${s.date}:${s.kind}:${s.symbol}`, kind: s.kind, symbol: s.symbol, ticker: s.ticker, name: s.name, market: s.market, signalDate: s.date, signalPrice: s.price,
      ...(s.kind === "drift" ? { movePct: s.movePct ?? null, volX: s.volX ?? null, results: !!s.results } : { rsi2: s.rsi2 ?? null }), status: "pending" });
    open.add(k);
  }
  return out;
}

// Fill at the next open, then exit under the setup's own rule; net after
// costs (UK 0.5% stamp duty, US 0.3% FX both ways, as tested) and against the
// home index (idx: Map date -> close).
export function updateShort(t, rows, idx = null) {
  if (!rows?.length || t.status === "closed") return t;
  const i0 = rows.findIndex((r) => r.date > t.signalDate);
  if (i0 < 0) return t;
  const entry = rows[i0].open > 0 ? rows[i0].open : rows[i0].close;
  const u = { ...t, status: "open", entryDate: rows[i0].date, entry: r2(entry) };
  let exitAt = null;
  if (t.kind === "drift") { if (rows.length - 1 >= i0 + ST.driftHold - 1) exitAt = i0 + ST.driftHold - 1; }
  else {
    const close = rows.map((r) => r.close), s5 = sma(close, 5);
    for (let k = i0; k < rows.length && k < i0 + ST.bounceMax; k++) {
      if ((s5[k] != null && close[k] > s5[k]) || k === i0 + ST.bounceMax - 1) { exitAt = k; break; }
    }
  }
  const at = exitAt ?? rows.length - 1, px = rows[at].close;
  const gross = px / entry - 1, net = gross - (COSTS[t.market] ?? COSTS.US);
  const ib = idx?.get?.(rows[i0 - 1]?.date) ?? null, ie = idx?.get?.(rows[at].date) ?? null;
  const vsIdx = ib && ie ? r2((net - (ie / ib - 1)) * 100) : null;
  Object.assign(u, { lastDate: rows[at].date, last: r2(px), netPct: r2(net * 100), vsIdx, sessions: at - i0 + 1 });
  if (exitAt != null) Object.assign(u, { status: "closed", exitDate: rows[at].date, exit: r2(px) });
  return u;
}

// Live record per kind (closed trades).
export function summariseShort(log = []) {
  const out = {};
  for (const kind of ["drift", "bounce"]) {
    const c = log.filter((t) => t.kind === kind && t.status === "closed");
    const vi = c.filter((t) => t.vsIdx != null);
    out[kind] = { closed: c.length, open: log.filter((t) => t.kind === kind && t.status !== "closed").length,
      win: c.length ? Math.round((c.filter((t) => t.netPct > 0).length / c.length) * 100) : null,
      avg: c.length ? r2(c.reduce((a, t) => a + t.netPct, 0) / c.length) : null,
      vsIdx: vi.length ? r2(vi.reduce((a, t) => a + t.vsIdx, 0) / vi.length) : null };
  }
  return out;
}

const sg = (x) => (x == null ? "n/a" : `${x > 0 ? "+" : ""}${x}%`);
const liveTxt = (l) => (l?.closed ? `live ${l.closed} closed, ${l.win}% won, avg ${sg(l.avg)}` : "live: none closed yet");

const short = (n) => String(n ?? "").replace(/,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Holdings|plc|PLC|Ltd\.?|Company)$/g, "");
const exitRule = (kind) => (kind === "drift" ? "hold 20 sessions" : "sell at the first close above its 5-day average, or after 10 sessions");

// The push (alert kind "short"), once per scan date. st: scan.json shortTerm,
// with st.pot from src/shortPot.js (the real-money pot, since 11 Nov).
export function shortTermAlert(st, seen = null) {
  if (!st?.date || st.date === seen) return null;
  const { drift = [], bounce = [], pot = null } = st;
  const buys = pot?.buys ?? [], sells = pot?.sells ?? [];
  if (!drift.length && !bounce.length && !sells.length) return null;
  const T = st.tested ?? {}, L = st.live ?? {};
  const sig = Object.fromEntries([...drift, ...bounce].map((x) => [`${x.kind}:${x.symbol}`, x]));
  const what = (x) => { const s = sig[`${x.kind}:${x.symbol}`]; return x.kind === "drift" ? `results drift${s ? `, ${sg(s.movePct)} on ${s.volX}x volume${s.results ? " (results)" : ""}` : ""}` : `bounce${s ? `, 2-day RSI ${s.rsi2}, ${sg(s.fall3)} over 3 days` : ""}`; };
  const lines = [];
  if (pot) {
    lines.push(`Short-term pot (real money, 10% of the portfolio)${pot.paused ? ": PAUSED, 25% below its high. No new buys; review the pot before resuming." : "."}`);
    if (buys.length) {
      lines.push("Buy at the next open, a fifth of the pot each (about 2% of the portfolio):");
      for (const b of buys) lines.push(`- ${b.ticker} (${short(b.name)}): ${what(b)}. Then ${exitRule(b.kind)}.`);
    }
    if (sells.length) {
      lines.push("Sell at the next open (exit rule met at the last close):");
      for (const x of sells) lines.push(`- ${x.ticker} (${short(x.name)}): ${x.kind === "drift" ? "20 sessions up" : "back above its 5-day average or 10 sessions up"}, ${sg(x.netPct)} after costs.`);
    }
    lines.push(`Pot: ${pot.open?.length ?? 0} of ${pot.rules?.maxOpen ?? 5} slots used after these, ${pot.start ? `${sg(pot.returnPct)} since ${pot.start}` : "no trades yet"}.`);
    const missed = [...drift, ...bounce].filter((x) => !buys.some((b) => b.kind === x.kind && b.symbol === x.symbol));
    if (missed.length) lines.push(`Not taken (${pot.paused ? "paused" : "no free slot or already held"}): ${missed.map((x) => x.ticker).join(", ")}.`);
  } else {
    for (const x of drift) lines.push(`- ${x.ticker} (${short(x.name)}): ${what(x)}.`);
    for (const x of bounce) lines.push(`- ${x.ticker} (${short(x.name)}): ${what(x)}.`);
  }
  const td = T.drift, tb = T.bounce;
  lines.push(`Evidence. Drift: tested ${td ? `avg ${sg(td.avg)} a trade after costs vs ${sg(td.random)} random, ${td.win}% won, ahead in ${td.yearsAhead} of ${td.years} years` : "n/a"}; ${liveTxt(L.drift)}. Bounce: tested ${tb ? `${tb.win}% won but avg ${sg(tb.avg)} a trade after costs` : "n/a"}; ${liveTxt(L.bounce)}.`);
  const act = [buys.length ? `buy ${buys.map((b) => b.ticker).join(", ")}` : null, sells.length ? `sell ${sells.map((x) => x.ticker).join(", ")}` : null].filter(Boolean);
  const names = [...drift, ...bounce].map((x) => x.ticker);
  return { kind: "short", priority: act.length ? "high" : "default", tags: "zap",
    title: act.length ? `Short-term pot: ${act.join(" · ")}` : `Short-term signals: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` +${names.length - 6}` : ""}${pot ? ` (pot ${pot.paused ? "paused" : "full"})` : ""}`,
    body: lines.join("\n") };
}
