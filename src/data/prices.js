// Daily price history. Yahoo Finance's chart endpoint is the primary source
// (no key, full history, indices and UK shares). When Yahoo fails for a symbol,
// CNBC's chart feed is the second source (about two years of daily bars; 14 Nov;
// see cnbc.js). Alpha Vantage is kept as a last fallback for US tickers if
// ALPHAVANTAGE_KEY is set.
import { fetchJson } from "./http.js";
import { fetchCnbc } from "./cnbc.js";
import { dateIn, sleep } from "../util.js";

const YAHOO_HOSTS = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];

// Returns { symbol, currency, tz, rows: [{date, open, high, low, close, volume}], live, source }
// rows are oldest first. If the market is open, the last row is today's
// in-progress bar priced at the latest quote (live: true).
// backup: false keeps a call on Yahoo only (bulk scans; the backup is for
// the alert chain). PRICES_FORCE_BACKUP=1 skips Yahoo (dry runs only).
export async function fetchDaily(symbol, { range = "2y", backup = true } = {}) {
  let lastErr;
  if (process.env.PRICES_FORCE_BACKUP !== "1") {
    for (const host of YAHOO_HOSTS) {
      try {
        const j = await fetchJson(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false&events=split`, { tries: 2 });
        const res = j?.chart?.result?.[0];
        if (!res?.timestamp?.length) throw new Error(`No chart data for ${symbol}`);
        return { ...parseYahoo(res), symbol, source: "yahoo" };
      } catch (e) { lastErr = e; }
    }
  } else lastErr = new Error("Yahoo skipped (PRICES_FORCE_BACKUP)");
  if (backup) {
    try {
      const c = await fetchCnbc(symbol);
      console.warn(`Prices: ${symbol} from the backup source (CNBC, ${c.rows.length} bars to ${c.rows.at(-1).date}); Yahoo failed: ${lastErr?.message ?? "unknown"}`);
      backupUsed.add(symbol);
      return c;
    } catch (e) { if (!/No CNBC mapping/.test(e.message)) console.warn(`Backup prices failed for ${symbol}: ${e.message}`); }
  }
  const av = await fetchAlphaVantage(symbol).catch((e) => { lastErr = e; return null; });
  if (av) return av;
  throw lastErr ?? new Error(`No data for ${symbol}`);
}

// Symbols served by the backup source in this run (the monitor's health shows them).
const backupUsed = new Set();
export const backupSymbols = () => [...backupUsed];

export function parseYahoo(res) {
  const tz = res.meta?.exchangeTimezoneName || "America/New_York";
  const q = res.indicators?.quote?.[0] || {};
  const byDate = new Map();
  res.timestamp.forEach((ts, i) => {
    const close = q.close?.[i];
    if (close == null || !Number.isFinite(close)) return;
    const date = dateIn(tz, new Date(ts * 1000));
    byDate.set(date, { date, open: q.open?.[i] ?? close, high: q.high?.[i] ?? close, low: q.low?.[i] ?? close, close, volume: q.volume?.[i] ?? 0 });
  });
  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const splits = Object.values(res.events?.splits || {}).map((x) => ({ date: dateIn(tz, new Date(x.date * 1000)), ratio: x.numerator && x.denominator ? x.numerator / x.denominator : null }))
    .filter((x) => x.ratio && x.ratio !== 1).sort((a, b) => (a.date < b.date ? -1 : 1));
  const adjusted = adjustSplits(rows, splits);
  if (adjusted.length) console.warn(`Split guard: rescaled bars before ${adjusted.map((a) => `${a.date} (${a.ratio}:1)`).join(", ")}${m0(res)}`);
  let live = false;
  const m = res.meta || {};
  if (Number.isFinite(m.regularMarketPrice) && m.regularMarketTime) {
    const d = dateIn(tz, new Date(m.regularMarketTime * 1000));
    const last = rows[rows.length - 1];
    if (!last || d > last.date) {
      rows.push({ date: d, open: m.regularMarketPrice, high: m.regularMarketDayHigh ?? m.regularMarketPrice, low: m.regularMarketDayLow ?? m.regularMarketPrice, close: m.regularMarketPrice, volume: m.regularMarketVolume ?? 0 });
      live = true;
    } else if (d === last.date) {
      last.close = m.regularMarketPrice;
      live = true;
    }
  }
  const badBars = dropBadBars(rows);
  if (badBars.length) {
    console.warn(`Bad bar guard: dropped ${badBars.map((b) => `${b.date} (${b.close} after ${b.prev})`).join(", ")}${m0(res)}`);
    // The live quote was the bad bar: the series now ends at the last good close.
    if (live && badBars.some((b) => b.date > rows.at(-1)?.date)) live = false;
  }
  // "live" means the latest bar may still be moving (today, market open or
  // just closed). The caller treats the last bar as "latest", not "close".
  const asOf = m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : (rows.length ? rows[rows.length - 1].date + "T21:00:00Z" : null);
  return { currency: m.currency ?? null, tz, rows, live, asOf, name: m.shortName || m.longName || null, longName: m.longName || null, splits, badBars };
}

const m0 = (res) => (res.meta?.symbol ? ` for ${res.meta.symbol}` : "");

// Yahoo's chart closes are normally split-adjusted, but not always straight
// after a split. For each split, if the bars before it are still on the old
// basis (the close before over the close on the split day is near the ratio,
// within 30%, rather than near 1), divide the earlier prices by the ratio (and
// multiply volume). Mutates rows; returns the splits it applied.
export function adjustSplits(rows, splits) {
  const done = [];
  for (const sp of splits) {
    const k = rows.findIndex((r) => r.date >= sp.date);
    if (k <= 0) continue;
    const jump = rows[k - 1].close / rows[k].close;
    const near = (x, y) => Math.abs(Math.log(x / y)) < Math.log(1.3);
    if (!near(jump, sp.ratio) || near(jump, 1)) continue;
    for (let i = 0; i < k; i++) {
      const r = rows[i];
      r.open /= sp.ratio; r.high /= sp.ratio; r.low /= sp.ratio; r.close /= sp.ratio; r.volume *= sp.ratio;
    }
    done.push(sp);
  }
  return done;
}

// Yahoo sometimes serves one impossible price: SanDisk's 19 Nov quote read
// 755.16 after 96.5 (+678% on normal volume), which topped the Trends
// momentum, gainers and new-highs lists. A bar is dropped when its close is 3x
// or a third of the previous close, it traded under 3x its usual volume (real
// news, a collapse or a takeover, comes on heavy volume; indices with no
// volume rely on the size alone), no split explains it (adjustSplits runs
// first), and either it is the latest bar or the next close goes back within
// 30% of the previous one. A level that holds is kept: an unflagged split is
// dropped for one day at most, then kept once the next bar confirms it.
// Mutates rows; returns [{date, close, prev}] for the bars it dropped.
export function dropBadBars(rows) {
  const out = [];
  const far = (x, y) => Math.abs(Math.log(x / y)) >= Math.log(3);
  const near = (x, y) => Math.abs(Math.log(x / y)) < Math.log(1.3);
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], r = rows[i], next = rows[i + 1];
    if (!(prev.close > 0) || !(r.close > 0) || !far(r.close, prev.close)) continue;
    const past = rows.slice(Math.max(0, i - 20), i).map((b) => b.volume).filter((v) => v > 0);
    const avg = past.length ? past.reduce((a, v) => a + v, 0) / past.length : 0;
    if (avg > 0 && r.volume >= avg * 3) continue;
    if (next && !(next.close > 0 && near(next.close, prev.close))) continue;
    out.push({ date: r.date, close: r.close, prev: prev.close });
    rows.splice(i, 1);
    i--;
  }
  return out;
}

async function fetchAlphaVantage(symbol) {
  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key || symbol.startsWith("^") || symbol.includes(".")) return null;
  const j = await fetchJson(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${key}`, { tries: 1 });
  const series = j["Time Series (Daily)"];
  if (!series) return null;
  const rows = Object.entries(series).map(([date, v]) => ({
    date, open: +v["1. open"], high: +v["2. high"], low: +v["3. low"], close: +v["4. close"], volume: +v["5. volume"],
  })).filter((r) => Number.isFinite(r.close)).sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows.length ? { symbol, currency: "USD", tz: "America/New_York", rows, live: false, asOf: rows[rows.length - 1].date + "T21:00:00Z", source: "alphavantage" } : null;
}

// Fetch many symbols politely; failures come back as null rather than throwing.
export async function fetchMany(symbols, opts = {}, gapMs = 350) {
  const out = {};
  for (const s of symbols) {
    try { out[s] = await fetchDaily(s, opts); }
    catch (e) { console.warn(`Price fetch failed for ${s}: ${e.message}`); out[s] = null; }
    await sleep(gapMs);
  }
  return out;
}
