// Research: does the trim signal ("Overheated": F&G >= 80, S&P 500 10%+ above
// its 200-day, VIX <= 15) say anything about what comes next, and would acting
// on it have paid?
// Pure functions over aligned daily rows (oldest first):
//   { date, close, tr?, cash?, vix?, fg? }
// `close` is the S&P 500 price index (what the live rule watches), `tr` the
// total-return index used for wealth (defaults to close), `cash` the annual
// cash yield in %, `fg` the CNN Fear & Greed score (real or proxy).
import { stats, fwd } from "./dipStudy.js";

const H = { m1: 21, m3: 63, m6: 126, y1: 252 };
const pct = (a, b) => (a / b - 1) * 100;
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// Simple moving average per bar (null until `n` values).
export function sma(xs, n) {
  const out = new Array(xs.length).fill(null);
  let s = 0, k = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] == null) { s = 0; k = 0; continue; }
    s += xs[i]; k++;
    if (k > n) { s -= xs[i - n]; k = n; }
    if (k === n) out[i] = s / n;
  }
  return out;
}

// Share (0..1) of the trailing `win` values (inclusive) at or below xs[i].
function rankTrailing(xs, win) {
  const out = new Array(xs.length).fill(null);
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] == null) continue;
    let n = 0, le = 0;
    for (let j = Math.max(0, i - win + 1); j <= i; j++) {
      if (xs[j] == null) continue;
      n++; if (xs[j] <= xs[i]) le++;
    }
    if (n >= win * 0.8) out[i] = le / n;
  }
  return out;
}

// Fear & Greed stand-in for the years before our real history (2020 on),
// from three of CNN's seven inputs we can rebuild from free daily data:
// momentum (S&P vs its 125-day average), price strength (distance from the
// 52-week high) and volatility (VIX against its 50-day average, inverted).
// Each is ranked against the trailing two years and the ranks averaged, 0..100.
export function greedProxy(rows, { win = 504 } = {}) {
  const c = rows.map((r) => r.close), v = rows.map((r) => r.vix ?? null);
  const m125 = sma(c, 125), v50 = sma(v, 50);
  const mom = c.map((x, i) => (m125[i] ? x / m125[i] - 1 : null));
  const hi = c.map((x, i) => (i >= 251 ? x / Math.max(...c.slice(i - 251, i + 1)) - 1 : null));
  const vol = v.map((x, i) => (x != null && v50[i] ? -(x / v50[i] - 1) : null));
  const R = [rankTrailing(mom, win), rankTrailing(hi, win), rankTrailing(vol, win)];
  return rows.map((_, i) => (R.every((r) => r[i] != null) ? r1(((R[0][i] + R[1][i] + R[2][i]) / 3) * 100) : null));
}

// Percent above the 200-day average, per bar.
export function vs200(rows) {
  const m = sma(rows.map((r) => r.close), 200);
  return rows.map((r, i) => (m[i] ? pct(r.close, m[i]) : null));
}

// Episodes of the rule, as the live alert works: it fires when every condition
// holds and it is not already active, and re-arms once the score falls below
// `reset`. With useFg false (no sentiment history) only price and VIX count and
// it re-arms when the S&P is back under `rearmAbove`% above its 200-day.
export function trimEpisodes(rows, { minScore = 80, minAbove = 10, maxVix = 15, reset = 65, useFg = true, rearmAbove = 5, warm = 252 } = {}) {
  const above = vs200(rows);
  const starts = [];
  let active = false;
  for (let i = warm; i < rows.length; i++) {
    const r = rows[i];
    if (useFg && r.fg == null) continue;
    if (above[i] == null) continue;
    const vixOk = r.vix == null || r.vix <= maxVix;
    const on = (!useFg || r.fg >= minScore) && above[i] >= minAbove && vixOk;
    if (on && !active) { starts.push(i); active = true; }
    if (active && (useFg ? r.fg < reset : above[i] < rearmAbove)) active = false;
  }
  return starts;
}

// Worst close over the next h bars against bar i (%), or null near the end.
export function maxDrawdownAhead(rows, i, h = 252) {
  if (i + h >= rows.length) return null;
  let lo = rows[i].close;
  for (let j = i + 1; j <= i + h; j++) lo = Math.min(lo, rows[j].close);
  return pct(lo, rows[i].close);
}

// Forward total returns and the drawdown ahead after each episode start, and
// for every bar (baseline), plus "on" days (all days the conditions held).
export function trimForward(rows, starts, { warm = 252 } = {}) {
  const tr = rows.map((r) => ({ close: r.tr ?? r.close }));
  const block = (idx) => ({
    ...Object.fromEntries(Object.entries(H).map(([k, h]) => [k, stats(idx.map((i) => fwd(tr, i, h)).filter((x) => x != null))])),
    ddAhead1y: stats(idx.map((i) => maxDrawdownAhead(rows, i)).filter((x) => x != null)),
    fall10in1y: (() => { const d = idx.map((i) => maxDrawdownAhead(rows, i)).filter((x) => x != null); return d.length ? Math.round((d.filter((x) => x <= -10).length / d.length) * 100) : null; })(),
  });
  const all = [];
  for (let i = warm; i < rows.length; i++) all.push(i);
  return { episodes: starts.length, dates: starts.map((i) => rows[i].date), atSignal: block(starts), baseline: block(all) };
}

// Acting on the signal: hold the index from bar s to e; at each episode start
// inside the window move `frac` of the holding to cash, and buy back after
// `holdBars` (or earlier, if `backBelow200`, at the first close under the
// 200-day average). Returns wealth relative to simply holding (%).
export function trimSim(rows, starts, s, e, { frac = 0.1, holdBars = 126, backBelow200 = false } = {}, above = vs200(rows)) {
  const px = (i) => rows[i].tr ?? rows[i].close;
  let units = 1 / px(s), cash = 0, since = null, trades = 0;
  const set = new Set(starts);
  for (let i = s; i <= e; i++) {
    if (i > s) cash *= 1 + (rows[i - 1].cash ?? 0) / 100 / 252;
    if (since != null && (i - since >= holdBars || (backBelow200 && above[i] != null && above[i] < 0))) {
      units += cash / px(i); cash = 0; since = null;
    }
    if (set.has(i) && since == null && i < e) {
      const sell = units * frac; units -= sell; cash += sell * px(i); since = i; trades++;
    }
  }
  return { vsHold: pct(units * px(e) + cash, 1), trades };
}

// Rolling windows of `years`, one starting each month.
export function trimRolling(rows, starts, variants, { years = 10, warm = 252 } = {}) {
  const above = vs200(rows);
  const ws = [];
  let last = null;
  for (let i = warm; i < rows.length; i++) {
    const m = rows[i].date.slice(0, 7);
    if (m !== last) { ws.push(i); last = m; }
  }
  const len = Math.round(years * 252), out = {};
  for (const [name, v] of Object.entries(variants)) {
    const d = [], t = [];
    for (const s of ws) {
      const e = s + len;
      if (e >= rows.length) break;
      const r = trimSim(rows, starts, s, e, v, above);
      d.push(r.vsHold); t.push(r.trades);
    }
    out[name] = { windows: d.length, vsHold: stats(d), worst: d.length ? r1(Math.min(...d)) : null, best: d.length ? r1(Math.max(...d)) : null, tradesPerWindow: stats(t).mean };
  }
  return out;
}

// Pearson correlation of two equal-length series, skipping pairs with a null.
export function corr(a, b) {
  const p = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x != null && y != null);
  if (p.length < 3) return null;
  const mx = p.reduce((s, [x]) => s + x, 0) / p.length, my = p.reduce((s, [, y]) => s + y, 0) / p.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100;
}
