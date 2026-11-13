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
import { openPhrase } from "./sessions.js";

export const ST = { maxDrift: 5, maxBounce: 5, rsi2Below: 10, bounceMax: 10, driftHold: 20 };
export const ST_LABEL = { drift: "Results drift", bounce: "Bounce in an uptrend" };

// Backtest record from data/swing-lab.json (results without the stop).
export function testedRecord(lab) {
  const pick = (key) => {
    const r = lab?.results?.find((x) => x.key === key && !x.stop);
    return r ? { n: r.signal.n, avg: r.signal.avg, win: r.signal.win, vsIdx: r.signal.vsIdx, random: r.baseline.avg, edge: r.edge, yearsAhead: r.yearsAhead, years: r.yearsCounted, ...(r.signal.sd != null ? { sd: r.signal.sd } : {}) } : null;
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
      // Near a results date: the last one, or the scheduled one when Yahoo has
      // not rolled it over yet (Burberry's 12 Nov interims showed only there).
      const near = (x) => !!(x && Math.abs(Date.parse(d.date) - Date.parse(x)) <= 3 * 86400000);
      const nearResults = near(i.lastEarnings) || near(i.earnings?.date);
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
      ...(s.kind === "drift" ? { movePct: s.movePct ?? null, volX: s.volX ?? null, results: !!s.results, surprisePct: s.surprisePct ?? null } : { rsi2: s.rsi2 ?? null }), status: "pending" });
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
    // Spread and a 90% range for the average (normal approximation), so a
    // live record is read with its noise (research log 12 Nov).
    if (c.length >= 2) {
      const m = c.reduce((a, t) => a + t.netPct, 0) / c.length;
      const sd = Math.sqrt(c.reduce((a, t) => a + (t.netPct - m) ** 2, 0) / (c.length - 1));
      out[kind].sd = r2(sd);
      if (c.length >= 5) { const h = (Z90 * sd) / Math.sqrt(c.length); out[kind].lo = r2(m - h); out[kind].hi = r2(m + h); }
    }
  }
  return out;
}

// Reading the live record against the agreed review (strategy notes: after 30
// closed live trades, drop a setup that trails random entry after costs).
// Research log 12 Nov: a 20-session drift trade has a spread of about 12
// points, so 30 trades leave a 90% range of about +/-3.6 points around the
// average, six times the backtest's whole edge (0.58). A setup with exactly
// the backtest's edge would still trail random entry at 30 trades about 40%
// of the time. Display only: the rule itself is unchanged until Douglas agrees.
export const REVIEW_AT = 30;
const Z90 = 1.645;
// Standard normal CDF (Abramowitz and Stegun 26.2.17, error under 1e-7).
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
// Chance that a setup whose true edge is the backtest's still trails random
// entry after n trades.
export function trailOdds(t, n = REVIEW_AT) {
  if (!(t?.sd > 0) || t.edge == null || !(n > 0)) return null;
  return Math.round(normCdf(-t.edge / (t.sd / Math.sqrt(n))) * 100);
}
// Trades needed before the 90% range is narrower than the backtest's edge.
export function tradesToTell(t) {
  if (!(t?.sd > 0) || !(t?.edge > 0)) return null;
  return Math.ceil(((Z90 * t.sd) / t.edge) ** 2);
}
// One line for the Dashboard: where the live record stands against random entry.
export function liveVerdict(l, t) {
  const n = l?.closed ?? 0, rnd = t?.random;
  const odds = trailOdds(t);
  const noise = odds != null ? ` Even with the backtest's edge, a setup trails random entry at ${REVIEW_AT} trades about ${odds}% of the time, so one review is a weak test.` : "";
  if (n < REVIEW_AT) return { stage: "early", tone: "neutral", text: `${n} of ${REVIEW_AT} closed before the review.${noise}` };
  if (rnd == null || l.avg == null) return { stage: "review", tone: "neutral", text: `${n} closed; no backtest to compare with.` };
  const range = l.lo != null ? ` (90% range ${sgn(l.lo)} to ${sgn(l.hi)})` : "";
  const vs = `avg ${sgn(l.avg)}${range} against ${sgn(rnd)} for random entry`;
  if (l.hi != null && l.hi < rnd) return { stage: "review", tone: "bad", text: `Clearly behind random entry: ${vs}.` };
  if (l.avg < rnd) return { stage: "review", tone: "watch", text: `Behind random entry, within the noise: ${vs}.${noise}` };
  if (l.lo != null && l.lo > rnd) return { stage: "review", tone: "good", text: `Clearly ahead of random entry: ${vs}.` };
  return { stage: "review", tone: "neutral", text: `Ahead of random entry, within the noise: ${vs}.` };
}
const sgn = (x) => `${x > 0 ? "+" : ""}${x}%`;

const sg = (x) => (x == null ? "n/a" : `${x > 0 ? "+" : ""}${x}%`);
const liveTxt = (l) => (l?.closed ? `live ${l.closed} closed, ${l.win}% won, avg ${sg(l.avg)}` : "live: none closed yet");

const SUFFIX = /,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Holdings|plc|PLC|Ltd\.?|Company)$/;
const short = (n) => { let x = String(n ?? ""); for (let k = 0; k < 3 && SUFFIX.test(x); k++) x = x.replace(SUFFIX, ""); return x; };
const exitRule = (kind) => (kind === "drift" ? "hold 20 sessions" : "sell at the first close above its 5-day average, or after 10 sessions");

// The push (alert kind "short"), once per scan date. st: scan.json shortTerm,
// with st.pot from src/shortPot.js (the real-money pot, since 11 Nov).
// What the pot is told to do for one scan date: the same key means the same push.
export function shortActionKey(st) {
  if (!st?.date) return null;
  const k = (xs) => (xs ?? []).map((x) => `${x.kind}:${x.symbol}`).sort().join(",");
  return `${st.date}|${k(st.pot?.buys)}|${k(st.pot?.sells)}|${k(st.drift)}|${k(st.bounce)}`;
}

// Evening push (11 Nov): the scan pushes tonight's orders itself when it
// finishes before quiet hours, so the next-open orders can be placed the
// evening before (UK names open at 08:00, before the 08:15 run). A later rerun
// of the scan keeps the "pushed" mark only if the orders are unchanged.
export function carryPushed(prev, next) {
  if (!next || !prev?.pushedAt) return next;
  return shortActionKey(prev) === shortActionKey(next) ? { ...next, pushedAt: prev.pushedAt } : next;
}

// Takeover check (display only, 11 Nov evening): a drift signal with a jump of
// 12%+ may be a takeover offer. The backtest never saw one (it used today's
// index members, and bought-out companies have left the index), and a target's
// price usually sits near the offer for months, so there is no drift to catch.
// The pot's rules are unchanged; the push and Dashboard ask Douglas to check.
export const BIG_JUMP = 12;
export const bigJump = (s) => s?.kind === "drift" && (s.movePct ?? 0) >= BIG_JUMP;
export const TAKEOVER_NOTE = "a jump this size can be a takeover offer: check the news first (the backtest never saw a bought-out company, and the price usually stays near the offer)";

// The Dashboard's short-term list: the scan's own copy (history/short-term.json)
// when it is at least as new as the monitor's (data.json), else the monitor's.
export function newerShort(fromData, fromScan) {
  if (!fromScan?.date) return fromData ?? null;
  if (!fromData?.date) return fromScan;
  return fromScan.date >= fromData.date ? fromScan : fromData;
}

// now (optional): the current instant, so each order says when its open is.
export function shortTermAlert(st, seen = null, now = null) {
  if (!st?.date || st.date === seen || st.pushedAt) return null;
  const { drift = [], bounce = [], pot = null } = st;
  const buys = pot?.buys ?? [], sells = pot?.sells ?? [];
  if (!drift.length && !bounce.length && !sells.length) return null;
  const T = st.tested ?? {}, L = st.live ?? {};
  const sig = Object.fromEntries([...drift, ...bounce].map((x) => [`${x.kind}:${x.symbol}`, x]));
  const what = (x) => { const s = sig[`${x.kind}:${x.symbol}`]; return x.kind === "drift" ? `results drift${s ? `, ${sg(s.movePct)} on ${s.volX}x volume${s.results ? ` (results${s.surprisePct != null ? `, EPS ${sg(s.surprisePct)} vs forecast` : ""})` : ""}` : ""}` : `bounce${s ? `, 2-day RSI ${s.rsi2}, ${sg(s.fall3)} over 3 days` : ""}`; };
  const lines = [];
  if (pot) {
    lines.push(`Short-term pot (real money, 10% of the portfolio)${pot.paused ? ": PAUSED, 25% below its high. No new buys; review the pot before resuming." : "."}`);
    // Grouped by when the order's open is (13 Nov, late): the 08:15 fallback
    // push can arrive after London's 08:00 open, and Friday's list is Monday's.
    const at = (o, date) => openPhrase(date ?? pot.rules?.today ?? st.date, o.market, now);
    const groups = (list, dateOf) => { const g = new Map(); for (const o of list) { const p = at(o, dateOf(o)); const k = `${p.state}|${p.text}`; if (!g.has(k)) g.set(k, { p, list: [] }); g.get(k).list.push(o); } return [...g.values()]; };
    const passedNote = "now passed: if you still place them, log the price you get";
    for (const { p, list } of groups(buys, (b) => b.signalDate)) {
      lines.push(p.state === "passed" ? `Buys due at ${p.text}, ${passedNote} (a fifth of the pot each, about 2% of the portfolio):` : `Buy at ${p.text}, a fifth of the pot each (about 2% of the portfolio):`);
      for (const b of list) lines.push(`- ${b.ticker} (${short(b.name)}): ${what(b)}. Then ${exitRule(b.kind)}.${bigJump(sig[`${b.kind}:${b.symbol}`]) ? ` Note: ${TAKEOVER_NOTE}.` : ""}`);
    }
    for (const { p, list } of groups(sells, (x) => x.exitDate)) {
      lines.push(p.state === "passed" ? `Sells due at ${p.text}, ${passedNote} (exit rule met at the last close):` : `Sell at ${p.text} (exit rule met at the last close):`);
      for (const x of list) lines.push(`- ${x.ticker} (${short(x.name)}): ${x.kind === "drift" ? "20 sessions up" : "back above its 5-day average or 10 sessions up"}, ${sg(x.netPct)} after costs.`);
    }
    lines.push(`Pot: ${(pot.open?.length ?? 0) + buys.length - sells.length} of ${pot.rules?.maxOpen ?? 5} slots used after these, ${pot.start ? `${sg(pot.returnPct)} since ${pot.start}` : "no trades yet"}.`);
    const missed = [...drift, ...bounce].filter((x) => !buys.some((b) => b.kind === x.kind && b.symbol === x.symbol));
    if (missed.length) lines.push(`Not taken (${pot.paused ? "paused" : "no free slot or already held"}): ${missed.map((x) => x.ticker).join(", ")}.`);
  } else {
    for (const x of drift) lines.push(`- ${x.ticker} (${short(x.name)}): ${what(x)}.${bigJump(x) ? ` Note: ${TAKEOVER_NOTE}.` : ""}`);
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

// Drawdown alerts for the real-money pot (kind "short"), once per stage:
// a heads-up at WARN_FALL below its high, then the pause itself (25%).
// pot: scan.json shortTerm.pot; seen: state.shortPotStage ("warn" | "paused" | null).
// Returns { alert, stage }; the stage resets once the pot recovers to within 5%.
export const WARN_FALL = 15;
export function shortPauseAlert(pot, seen = null) {
  if (!pot?.rules || (pot.fallPct == null && !pot.paused)) return { alert: null, stage: seen };
  const fall = Math.abs(pot.fallPct ?? 0), pause = Math.round((pot.rules.pauseFall ?? 0.25) * 100);
  const stage = pot.paused ? "paused" : fall >= WARN_FALL ? "warn" : fall < 5 ? null : seen === "paused" ? "warn" : seen;
  const rank = { null: 0, warn: 1, paused: 2 };
  if (rank[stage] <= rank[seen]) return { alert: null, stage };
  const held = (pot.open ?? []).map((o) => `${o.ticker} ${o.openPct > 0 ? "+" : ""}${o.openPct}%`).join(", ");
  const alert = stage === "paused"
    ? { kind: "short", priority: "high", tags: "warning", title: `Short-term pot paused: ${fall.toFixed(1)}% below its high`,
      body: [`The real-money short-term pot is ${pause}% or more below its high, so the rules stop new trades. Trades already open still follow their exit rules; nothing is sold early.`,
        held ? `Held: ${held}.` : null, `Since its start: ${pot.returnPct > 0 ? "+" : ""}${pot.returnPct}%${pot.closed ? `; ${pot.closed} closed, ${pot.winRate}% won` : ""}.`,
        "Next: review the pot with Claude before resuming (strategy notes)."].filter(Boolean).join("\n") }
    : { kind: "short", priority: "default", tags: "chart_with_downwards_trend", title: `Short-term pot ${fall.toFixed(1)}% below its high`,
      body: [`Heads-up: the real-money short-term pot is ${fall.toFixed(1)}% below its high. It pauses new trades at ${pause}%. No action needed; trades follow their rules.`,
        held ? `Held: ${held}.` : null].filter(Boolean).join("\n") };
  return { alert, stage };
}
