// Second price source (14 Nov 2026): CNBC's public chart and quote feeds, used
// only when Yahoo fails for a symbol, so the alert chain keeps real prices
// (Yahoo is otherwise the single source). Stooq was tried first: it refuses
// GitHub's runners ("Access denied"). Nasdaq's API has no indices; FT and
// MarketWatch need keys or captchas. CNBC answered for indices, UK and US.
//
// CNBC's "1Y" chart gives about two years of daily bars (checked 14 Nov on the
// runner: closes matched Yahoo's exactly over 60 sessions for every monitor
// symbol), enough for the 52-week drawdown, the 200-day average and every
// monitor check, but not the S&P 500's ten-year context table, which keeps its
// last good copy.
import { fetchJson } from "./http.js";
import { dateIn } from "../util.js";

const INDEX = { "^GSPC": ".SPX", "^FTSE": ".FTSE", "^VIX": ".VIX", "^STOXX50E": ".STOXX50E", "^N225": ".N225", "^HSI": ".HSI", "^NDX": ".NDX", "^DJI": ".DJI" };
const TZ = { ".FTSE": "Europe/London", ".STOXX50E": "Europe/Berlin", ".N225": "Asia/Tokyo", ".HSI": "Asia/Hong_Kong" };

// European listings (19 Nov): Yahoo's exchange suffix to CNBC's country code
// and the exchange's zone. Checked on the runner with tools/cnbc-eu-probe.mjs:
// 49 of the 50 Euro Stoxx 50 names matched Yahoo's closes exactly over 60
// sessions, all in EUR. Nordea (NDA-FI.HE) had no working spelling, so a base
// with a hyphen stays Yahoo only, as do exchanges not listed here.
const EU = { PA: ["FR", "Europe/Paris"], DE: ["DE", "Europe/Berlin"], AS: ["NL", "Europe/Amsterdam"], MI: ["IT", "Europe/Rome"], MC: ["ES", "Europe/Madrid"], BR: ["BE", "Europe/Brussels"], HE: ["FI", "Europe/Helsinki"] };
const euParts = (symbol) => { const m = /^([A-Z0-9]+)\.([A-Z]{2})$/.exec(symbol ?? ""); return m && EU[m[2]] ? { base: m[1], cc: EU[m[2]][0], tz: EU[m[2]][1] } : null; };

// Yahoo symbol to CNBC symbol, or null where we have not checked a mapping.
export function cnbcSymbol(symbol) {
  if (!symbol) return null;
  if (INDEX[symbol]) return INDEX[symbol];
  if (symbol.startsWith("^")) return null;
  const eu = euParts(symbol);
  if (eu) return `${eu.base}-${eu.cc}`;
  const uk = /^([A-Z0-9]+)(?:-([A-Z]))?\.L$/.exec(symbol);
  // London's one- and two-letter tickers end in a dot ("BA.", "RR."); without
  // it CNBC finds other, dollar-priced instruments (19 Nov, runner).
  if (uk) return `${uk[1]}${uk[2] ? `.${uk[2]}` : uk[1].length <= 2 ? "." : ""}-GB`;
  if (/^[A-Z]+(?:-[A-Z])?$/.test(symbol)) return symbol.replace("-", ".");
  return null;
}

// The exchange's zone, which decides whether the last bar is today's.
export function cnbcTz(symbol) {
  const cs = INDEX[symbol];
  if (cs && TZ[cs]) return TZ[cs];
  const eu = euParts(symbol);
  if (eu) return eu.tz;
  return /\.L$/.test(symbol ?? "") ? "Europe/London" : "America/New_York";
}

const isWeekend = (date) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
const num = (s) => (s == null || s === "" ? null : Number(String(s).replace(/[,$%]/g, "")));
const fin = (x) => Number.isFinite(x) ? x : null;

// CNBC chart bars to our rows (oldest first, one per date). tradeTime is
// "YYYYMMDDhhmmss" in the exchange's own day, so the date is its first 8 digits.
// Weekend bars are dropped: CNBC showed Saturday bars for SpaceX that no
// exchange session had.
export function parseCnbcBars(j) {
  const bars = j?.barData?.priceBars ?? [];
  const byDate = new Map();
  for (const b of bars) {
    const close = fin(num(b.close));
    const t = String(b.tradeTime ?? "");
    if (close == null || close <= 0 || !/^\d{8}/.test(t)) continue;
    const date = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
    if (isWeekend(date)) continue;
    const v = (k) => fin(num(b[k])) ?? close;
    byDate.set(date, { date, open: v("open"), high: v("high"), low: v("low"), close, volume: fin(Number(b.volume)) ?? 0 });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// The latest quote as a bar (CNBC's quote "last_time" is the exchange date),
// so a bar missing from the chart (today's session) is still counted.
export function quoteBar(q) {
  const close = fin(num(q?.last));
  const d = /^\d{4}-\d{2}-\d{2}/.exec(q?.last_time ?? "")?.[0];
  if (close == null || close <= 0 || !d || isWeekend(d)) return null;
  const v = (k) => fin(num(q[k])) ?? close;
  return { date: d, open: v("open"), high: v("high"), low: v("low"), close, volume: fin(num(q.volume)) ?? 0 };
}

// CNBC's currency code in Yahoo's spelling. Both quote a UK share in pence
// (GBp) and a UK ETF such as VWRP in pounds (GBP), so prices are kept as given.
export function yahooCurrency(code) {
  if (!code) return null;
  return /^GBX$/i.test(code) || code === "GBp" ? "GBp" : code;
}

// Same shape as fetchDaily's result. Throws if CNBC has nothing usable.
let failures = 0;
export async function fetchCnbc(symbol, { now = new Date() } = {}) {
  const cs = cnbcSymbol(symbol);
  if (!cs) throw new Error(`No CNBC mapping for ${symbol}`);
  if (failures >= 3) throw new Error("CNBC skipped after 3 failures in this run");
  try {
    const chart = await fetchJson(`https://ts-api.cnbc.com/harmony/app/charts/1Y.json?symbol=${encodeURIComponent(cs)}`, { tries: 2 });
    const rows = parseCnbcBars(chart);
    const qj = await fetchJson(`https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(cs)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`, { tries: 2 }).catch(() => null);
    const q = qj?.FormattedQuoteResult?.FormattedQuote?.[0] ?? null;
    const qb = quoteBar(q);
    if (qb && (!rows.length || qb.date > rows.at(-1).date)) rows.push(qb);
    else if (qb && qb.date === rows.at(-1).date) rows.at(-1).close = qb.close;
    const currency = yahooCurrency(q?.currencyCode);
    const uk = /\.L$/.test(symbol);
    // A UK price in unknown units (pence or pounds) could be 100 times out: refuse it.
    if (uk && !/^(GBP|GBp)$/.test(currency ?? "")) throw new Error(`CNBC gave no currency for ${symbol}`);
    // European listings were checked in euros only: refuse anything else.
    if (euParts(symbol) && currency !== "EUR") throw new Error(`CNBC gave ${currency ?? "no currency"} for ${symbol}`);
    if (rows.length < 30) throw new Error(`CNBC gave ${rows.length} bars for ${symbol}`);
    failures = 0;
    const tz = cnbcTz(symbol);
    const last = rows.at(-1).date;
    return {
      symbol, currency, tz, rows,
      live: last === dateIn(tz, now), asOf: last === dateIn(tz, now) ? now.toISOString() : `${last}T21:00:00Z`,
      name: q?.shortName ?? q?.name ?? null, splits: [], source: "cnbc",
    };
  } catch (e) {
    failures++;
    throw e;
  }
}
export function resetCnbcFailures() { failures = 0; }

// One line for the Dashboard and log when any price came from the backup:
// named for the indices and the core fund, counted for single stocks.
export function backupNote(symbols, config) {
  if (!symbols?.length) return null;
  const names = new Map([...(config?.world ?? []).map((w) => [w.symbol, w.name.replace(/^.*· /, "")]),
    [config?.indices?.vix?.symbol, "VIX"], [config?.coreFund?.symbol, config?.coreFund?.name]]);
  const named = symbols.filter((s) => names.has(s)).map((s) => names.get(s));
  const rest = symbols.length - named.length;
  const parts = [...named, ...(rest ? [`${rest} stock${rest === 1 ? "" : "s"}`] : [])];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Yahoo failed for ${list}, so ${symbols.length === 1 ? "its prices" : "their prices"} came from the backup source (CNBC). Signals still run; check any alert against Trading 212.`;
}
