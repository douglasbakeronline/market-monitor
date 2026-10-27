// Daily price history. Yahoo Finance's chart endpoint is the primary source
// (no key, full history, indices and UK shares). Alpha Vantage is kept as a
// fallback for US tickers if ALPHAVANTAGE_KEY is set.
import { fetchJson } from "./http.js";
import { dateIn, sleep } from "../util.js";

const YAHOO_HOSTS = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];

// Returns { symbol, currency, tz, rows: [{date, open, high, low, close, volume}], live, source }
// rows are oldest first. If the market is open, the last row is today's
// in-progress bar priced at the latest quote (live: true).
export async function fetchDaily(symbol, { range = "2y" } = {}) {
  let lastErr;
  for (const host of YAHOO_HOSTS) {
    try {
      const j = await fetchJson(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`, { tries: 2 });
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp?.length) throw new Error(`No chart data for ${symbol}`);
      return { ...parseYahoo(res), symbol, source: "yahoo" };
    } catch (e) { lastErr = e; }
  }
  const av = await fetchAlphaVantage(symbol).catch((e) => { lastErr = e; return null; });
  if (av) return av;
  throw lastErr ?? new Error(`No data for ${symbol}`);
}

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
  // "live" means the latest bar may still be moving (today, market open or
  // just closed). The caller treats the last bar as "latest", not "close".
  const asOf = m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : (rows.length ? rows[rows.length - 1].date + "T21:00:00Z" : null);
  return { currency: m.currency ?? null, tz, rows, live, asOf, name: m.shortName || m.longName || null };
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
