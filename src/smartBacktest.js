// Smart-money backtest (8 Nov): do new or added 13F positions of the tracked
// managers beat the S&P 500 after the filing is public? Pure functions only;
// tools/smart-backtest.mjs fetches the filings (13f.info) and prices (Yahoo).
import { diff, MIN_WEIGHT, toYahoo } from "./smartMoney.js";

export const HORIZONS = { m3: 63, m6: 126, m12: 252 };

// filings: [{period, filed, holdings: aggregate() rows with .ticker}] for one
// manager, any order. Returns events from each quarter-on-quarter change:
// new / added / held / trimmed at MIN_WEIGHT % of the portfolio or more, and
// sold (out of a position that was MIN_WEIGHT % or more last quarter).
export function quarterEvents(manager, filings, minWeight = MIN_WEIGHT) {
  const fs = [...filings].sort((a, b) => (a.period < b.period ? -1 : 1));
  const out = [];
  for (let i = 1; i < fs.length; i++) {
    const cur = fs[i], prev = fs[i - 1];
    // A missing quarter would make a six-month change look like a quarterly one.
    if (Date.parse(cur.period) - Date.parse(prev.period) > 100 * 86400000) continue;
    const { holdings, sold } = diff(cur.holdings, prev.holdings);
    const tick = new Map([...cur.holdings, ...prev.holdings].map((h) => [h.cusip, h.ticker]));
    for (const h of holdings) {
      if (h.weight < minWeight) continue;
      out.push({ manager, ticker: toYahoo(tick.get(h.cusip)) || null, name: h.name, change: h.change, weight: h.weight, period: cur.period, filed: cur.filed });
    }
    const pw = new Map(prev.holdings.map((h) => [h.cusip, h.weight]));
    for (const s of sold) {
      if ((pw.get(s.cusip) ?? 0) < minWeight) continue;
      out.push({ manager, ticker: toYahoo(tick.get(s.cusip)) || null, name: s.name, change: "sold", weight: pw.get(s.cusip), period: cur.period, filed: cur.filed });
    }
  }
  return out;
}

// Index of the first bar strictly after `date` (the filing is public by the
// next session at the latest), or -1.
export const entryIndex = (rows, date) => rows.findIndex((r) => r.date > date);

// Last bar on or before `date` in a date-sorted list, or null.
export function barOn(rows, date) {
  let lo = 0, hi = rows.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { k = m; lo = m + 1; } else hi = m - 1; }
  return k >= 0 ? rows[k] : null;
}

// Forward returns (in %) of one event against the benchmark over each horizon,
// in trading days from the first session after the filing date.
export function forward(ev, rows, bench) {
  const i = entryIndex(rows, ev.filed);
  if (i < 0) return null;
  const e = rows[i], be = barOn(bench, e.date);
  if (!be) return null;
  const res = { entry: e.date };
  for (const [k, n] of Object.entries(HORIZONS)) {
    const x = rows[i + n];
    const bx = x && barOn(bench, x.date);
    if (!x || !bx) { res[k] = null; continue; }
    const r = (x.close / e.close - 1) * 100, b = (bx.close / be.close - 1) * 100;
    res[k] = { ret: round(r), bench: round(b), excess: round(r - b) };
  }
  return res;
}

const round = (x) => Math.round(x * 10) / 10;
export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Summary of scored events at one horizon: count, distinct stocks, median and
// mean excess return, share that beat the benchmark, median raw return.
export function summarise(events, h, key = "fwd") {
  const xs = events.map((e) => e[key]?.[h]).filter(Boolean);
  if (!xs.length) return { n: 0 };
  const ex = xs.map((x) => x.excess);
  return {
    n: xs.length,
    stocks: new Set(events.filter((e) => e[key]?.[h]).map((e) => e.ticker)).size,
    medianExcess: round(median(ex)),
    meanExcess: round(ex.reduce((a, b) => a + b, 0) / ex.length),
    beat: Math.round((ex.filter((x) => x > 0).length / ex.length) * 100),
    medianRet: round(median(xs.map((x) => x.ret))),
  };
}

// One event per stock per quarter (two managers adding the same stock in the
// same quarter count once), keeping the first seen.
export function dedupe(events) {
  const seen = new Set();
  return events.filter((e) => { const k = `${e.ticker}|${e.period}`; return !seen.has(k) && seen.add(k); });
}

// Groups: "buy" (new or added: what the live tag and track-record event flag),
// "new", "added", "held", "trimmed", "sold"; all managers (deduplicated) and
// per manager for "buy". key picks the benchmark ("fwd" S&P 500, or another
// forward() result stored on each event).
export function analyse(events, key = "fwd") {
  const scored = events.filter((e) => e[key]);
  const pick = (f) => scored.filter(f);
  const all = (f) => Object.fromEntries(Object.keys(HORIZONS).map((h) => [h, summarise(dedupe(pick(f)), h, key)]));
  const isBuy = (e) => e.change === "new" || e.change === "added";
  const groups = { buy: all(isBuy) };
  for (const c of ["new", "added", "held", "trimmed", "sold"]) groups[c] = all((e) => e.change === c);
  const managers = {};
  for (const m of [...new Set(scored.map((e) => e.manager))]) {
    managers[m] = Object.fromEntries(Object.keys(HORIZONS).map((h) => [h, summarise(pick((e) => e.manager === m && isBuy(e)), h, key)]));
  }
  // By calendar year of the filing (for "buy"), to see whether one year does the work.
  const byYear = {};
  for (const y of [...new Set(scored.filter(isBuy).map((e) => e.filed.slice(0, 4)))].sort()) {
    byYear[y] = summarise(dedupe(pick((e) => isBuy(e) && e.filed.startsWith(y))), "m12", key);
  }
  return { groups, managers, byYear };
}

// Does Yahoo's name for a ticker look like the 13F issuer name? 13f.info's
// tickers are sometimes stale or reused (a delisted symbol now names another
// company), so events whose names share no meaningful word are dropped,
// unless Yahoo's name contains the ticker itself (a company renamed to it).
const STOP = new Set(["inc", "corp", "corporation", "co", "company", "the", "ltd", "plc", "holdings", "holding", "group", "class", "com", "new", "del", "sa", "nv", "ag", "se", "lp", "llc", "trust", "international", "intl", "cl", "a", "b", "c", "shs", "ord", "adr", "sponsored", "and", "of"]);
const words = (s) => String(s || "").toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
export function sameCompany(issuer, yahooName, ticker = null) {
  if (!yahooName) return true; // nothing to compare with
  // Renamed to its ticker (RTX Corporation, GSK plc, SLB Limited, GE Aerospace).
  const t = String(ticker || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t && String(yahooName).toLowerCase().split(/[^a-z0-9]+/).includes(t)) return true;
  const a = words(issuer), b = words(yahooName);
  if (!a.length || !b.length) return true;
  return a.some((x) => b.some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))));
}
