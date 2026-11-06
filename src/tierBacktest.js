// Research: do the dip-reserve buy tiers earn their keep?
// Two parts, pure functions over aligned daily rows (oldest first):
//  1. tierEvents: what followed the first close at each tier (-10/-15/-20/-30%
//     off the 52-week high), with and without fear confirmation.
//  2. simulate / rollingCompare: monthly saving into an index with a cash
//     reserve deployed at confirmed tiers, against putting everything in at once.
// Bars: { date, close, tr?, cash?, confirm? }. `close` is the price index the
// live rules watch; `tr` is the total-return index used for wealth (defaults to
// close); `cash` is the annual cash yield in % (defaults to 0); `confirm` is
// whether fear confirms on that day (VIX >= 30 or F&G <= 25).
import { drawdowns, stats, fwd } from "./dipStudy.js";

const H = { m6: 126, y1: 252, y2: 504 };
const pct = (a, b) => (a / b - 1) * 100;

// Episodes: a tier fires on the first close at or below its level and re-arms
// once the index is back within `reset`% of its high (the live rule uses -5).
export function tierEvents(rows, levels = [-10, -15, -20, -30], { reset = -5, warm = 252 } = {}) {
  const dd = drawdowns(rows);
  const out = {};
  for (const lvl of levels) {
    const hits = []; // { i, c } first hit and first confirmed hit (or null)
    let open = null;
    for (let i = warm; i < rows.length; i++) {
      if (open && dd[i] >= reset) { hits.push(open); open = null; }
      if (!open && dd[i] <= lvl) open = { i, c: null };
      if (open && open.c == null && dd[i] <= lvl && rows[i].confirm) open.c = i;
    }
    if (open) hits.push(open);
    const tr = rows.map((r) => ({ close: r.tr ?? r.close }));
    const fw = (idx) => Object.fromEntries(Object.entries(H).map(([k, h]) => [k, stats(idx.map((i) => fwd(tr, i, h)).filter((x) => x != null))]));
    const conf = hits.filter((h) => h.c != null);
    out[lvl] = {
      episodes: hits.length,
      dates: hits.slice(-6).map((h) => rows[h.i].date),
      confirmed: conf.length,
      daysToConfirm: stats(conf.map((h) => h.c - h.i)),
      // Price move between the first hit and the confirmed hit (negative = confirmation bought cheaper).
      confirmVsFirst: stats(conf.map((h) => pct(rows[h.c].tr ?? rows[h.c].close, rows[h.i].tr ?? rows[h.i].close))),
      atFirst: fw(hits.map((h) => h.i)),
      atConfirmed: fw(conf.map((h) => h.c)),
    };
  }
  const all = [];
  for (let i = warm; i < rows.length; i++) all.push(i);
  const tr = rows.map((r) => ({ close: r.tr ?? r.close }));
  out.baseline = Object.fromEntries(Object.entries(H).map(([k, h]) => [k, stats(all.map((i) => fwd(tr, i, h)).filter((x) => x != null))]));
  return out;
}

// One saver: 1 unit paid in on the first bar of each month. `reserve` of each
// payment goes to cash; at each tier (in order) a confirmed close deploys
// cash / (tiers left). Tiers re-arm at `reset`. If nothing was deployed or
// swept for `sweepAfter` bars, `sweepFrac` of the cash moves to the index.
// dd is precomputed drawdowns over the whole series so windows see real highs.
export function simulate(rows, dd, from, to, opt = {}) {
  const { reserve = 0.15, levels = [-10, -20, -30], reset = -5, confirm = true, sweepAfter = 252, sweepFrac = 0.5 } = opt;
  let units = 0, cash = 0, paid = 0, month = null, quiet = 0, deployed = 0, cashDays = 0, sumShare = 0;
  const hit = new Set();
  for (let i = from; i <= to; i++) {
    const r = rows[i], px = r.tr ?? r.close;
    if (i > from) cash *= 1 + (rows[i - 1].cash ?? 0) / 100 / 252;
    const m = r.date.slice(0, 7);
    if (m !== month) { month = m; paid += 1; units += (1 - reserve) / px; cash += reserve; }
    if (dd[i] >= reset) hit.clear();
    quiet++;
    if (reserve > 0) {
      const ok = !confirm || r.confirm;
      for (const l of levels) {
        if (hit.has(l) || dd[i] > l || !ok) continue;
        const left = levels.filter((x) => !hit.has(x)).length;
        const amt = cash / left;
        units += amt / px; cash -= amt; deployed++; hit.add(l); quiet = 0;
      }
      if (sweepAfter && quiet >= sweepAfter && cash > 0) { units += (cash * sweepFrac) / px; cash -= cash * sweepFrac; quiet = 0; }
    }
    const w = units * px + cash;
    if (w > 0) { sumShare += cash / w; cashDays++; }
  }
  const px = rows[to].tr ?? rows[to].close;
  return { wealth: units * px + cash, paid, deployed, avgCash: cashDays ? sumShare / cashDays : 0 };
}

// Rolling windows of `years` starting at each month; terminal wealth of the
// variant against all-in (reserve 0) over the same window.
// `dd` overrides the drawdown signal (e.g. combinedDrawdowns for "either
// index triggers the tier", as the live rule watches the S&P 500 and FTSE 100).
export function rollingCompare(rows, variants, { years = 10, warm = 252, step = 1, dd: ddIn = null } = {}) {
  const dd = ddIn ?? drawdowns(rows);
  const starts = [];
  let last = null;
  for (let i = warm; i < rows.length; i++) {
    const m = rows[i].date.slice(0, 7);
    if (m !== last) { starts.push(i); last = m; }
  }
  const len = Math.round(years * 252);
  const out = {};
  for (const [name, v] of Object.entries(variants)) {
    const diffs = [], deps = [], cashShare = [];
    for (let k = 0; k < starts.length; k += step) {
      const s = starts[k], e = s + len;
      if (e >= rows.length) break;
      const base = simulate(rows, dd, s, e, { reserve: 0 });
      const run = simulate(rows, dd, s, e, v);
      diffs.push(pct(run.wealth, base.wealth));
      deps.push(run.deployed);
      cashShare.push(run.avgCash * 100);
    }
    const st = stats(diffs);
    out[name] = {
      windows: diffs.length, vsAllIn: st,
      worst: diffs.length ? Math.round(Math.min(...diffs) * 10) / 10 : null,
      best: diffs.length ? Math.round(Math.max(...diffs) * 10) / 10 : null,
      avgCashPct: stats(cashShare).mean, deploymentsPerWindow: stats(deps).mean,
    };
  }
  return out;
}

// Join series by date onto the price rows. Missing tr/cash/confirm are
// forward-filled from the last known value (confirm is not, it stays false).
export function align(price, { tr = null, cash = null, vix = null, fg = null, alt = null } = {}) {
  const map = (xs) => (xs ? new Map(xs.map((r) => [r.date, r.close])) : null);
  const T = map(tr), C = map(cash), V = map(vix), A = map(alt);
  let lastTr = null, lastCash = null, lastAlt = null;
  return price.map((r) => {
    let t = T ? T.get(r.date) ?? null : r.close;
    if (T) {
      if (t != null) lastTr = t;
      else if (lastTr != null) t = lastTr; // holiday mismatch
    }
    const c = C ? (C.get(r.date) ?? lastCash) : null;
    if (c != null) lastCash = c;
    const a = A ? (A.get(r.date) ?? lastAlt) : null;
    if (a != null) lastAlt = a;
    const v = V?.get(r.date), f = fg?.[r.date];
    const row = { date: r.date, close: r.close, tr: t, cash: c ?? 0, vix: v ?? null, confirm: (v != null && v >= 30) || (f != null && f <= 25) };
    if (A) row.alt = a;
    return row;
  });
}

// Before 1990 there is no VIX: confirm when 21-day realised volatility
// (annualised) is at or above `level`% (VIX usually runs a few points above
// realised volatility, so 25 stands in for VIX 30). Only fills days with no VIX.
export function volProxy(rows, level = 25, win = 21) {
  const out = rows.map((r) => ({ ...r }));
  for (let i = win; i < rows.length; i++) {
    if (rows[i].vix != null) continue;
    let s = 0, s2 = 0;
    for (let j = i - win + 1; j <= i; j++) { const x = Math.log(rows[j].close / rows[j - 1].close); s += x; s2 += x * x; }
    const sd = Math.sqrt(Math.max(0, s2 / win - (s / win) ** 2)) * Math.sqrt(252) * 100;
    if (sd >= level) out[i].confirm = true;
  }
  return out;
}

// Drawdown signal when either of two indices can trigger a tier: the deeper of
// the two (rows carry `close` and a forward-filled `alt`). Before `alt` starts,
// only `close` counts.
export function combinedDrawdowns(rows, win = 252) {
  const a = drawdowns(rows, win);
  const first = rows.findIndex((r) => r.alt != null);
  if (first < 0) return a;
  const sub = rows.slice(first).map((r) => ({ close: r.alt }));
  const b = drawdowns(sub, win);
  return a.map((x, i) => (i >= first + win ? Math.min(x, b[i - first]) : x));
}

// Daily-rebalanced blend of two total-return series (aligned rows, oldest
// first): w of `a`, 1 - w of `b`. `yieldB` adds a constant annual yield in % to
// `b` (for a price-only index such as the FTSE 100). Starts at 100.
export function blendIndex(a, b, w = 0.6, { yieldB = 0 } = {}) {
  const out = [100];
  for (let i = 1; i < a.length; i++) {
    const ra = a[i] / a[i - 1] - 1, rb = b[i] / b[i - 1] - 1 + yieldB / 100 / 252;
    out.push(out[i - 1] * (1 + w * ra + (1 - w) * rb));
  }
  return out;
}
