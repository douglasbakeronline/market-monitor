// Company fundamentals and analyst data. Yahoo's quoteSummary is the primary
// source (no key, covers US and UK). It needs a session cookie and "crumb".
// If FINNHUB_KEY is set, Finnhub fills any gaps for US tickers.
import { UA, fetchJson } from "./http.js";
import { sleep } from "../util.js";

let session = null;

export async function yahooSession() {
  if (session) return session;
  const c = await fetch("https://fc.yahoo.com", { headers: { "user-agent": UA }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  const cookie = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "user-agent": UA, cookie }, signal: AbortSignal.timeout(15000) });
  const crumb = (await cr.text()).trim();
  if (!cr.ok || !crumb || crumb.length > 40) throw new Error(`Yahoo crumb failed (${cr.status})`);
  session = { cookie, crumb };
  return session;
}

const raw = (v) => (v && typeof v === "object" ? (Number.isFinite(v.raw) ? v.raw : null) : Number.isFinite(v) ? v : null);

const MODULES = "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile";

export async function fetchFundamentals(symbol) {
  let f = null;
  try {
    const { cookie, crumb } = await yahooSession();
    const j = await fetchJson(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`, { headers: { cookie }, tries: 2 });
    const r = j?.quoteSummary?.result?.[0];
    if (r) f = parseYahooSummary(r);
  } catch (e) {
    console.warn(`Fundamentals (Yahoo) failed for ${symbol}: ${e.message}`);
  }
  if (process.env.FINNHUB_KEY && !symbol.includes(".")) {
    try { f = mergeMissing(f || {}, await fetchFinnhub(symbol)); }
    catch (e) { console.warn(`Fundamentals (Finnhub) failed for ${symbol}: ${e.message}`); }
  }
  return f;
}

// EV/EBITDA alone (the scan's rotating peer sample, src/evSample.js): one
// light module per stock. Returns a number, or null when Yahoo has none.
// Throws on a failed request so the caller can leave the old value in place.
export async function fetchEvToEbitda(symbol) {
  const { cookie, crumb } = await yahooSession();
  const j = await fetchJson(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`, { headers: { cookie }, tries: 2 });
  const ks = j?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
  if (!ks) throw new Error("no result");
  return raw(ks.enterpriseToEbitda);
}

export function parseYahooSummary(r) {
  const p = r.price || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ap = r.assetProfile || {};
  const earn = (r.calendarEvents?.earnings?.earningsDate || []).map(raw).filter(Boolean).sort((a, b) => a - b);
  const now = Date.now() / 1000;
  const next = earn.find((t) => t > now - 86400) ?? null;
  const last = earn.filter((t) => t <= now - 86400).at(-1) ?? null; // results already out
  return {
    name: p.longName || p.shortName || null,
    currency: p.currency || null,
    exchange: p.exchangeName || null,
    sector: ap.sector || null,
    industry: ap.industry || null,
    marketCap: raw(p.marketCap) ?? raw(sd.marketCap),
    price: raw(p.regularMarketPrice) ?? raw(fd.currentPrice),
    trailingPE: raw(sd.trailingPE),
    forwardPE: raw(sd.forwardPE) ?? raw(ks.forwardPE),
    peg: raw(ks.pegRatio),
    evToEbitda: raw(ks.enterpriseToEbitda),
    priceToBook: raw(ks.priceToBook),
    priceToSales: raw(sd.priceToSalesTrailing12Months),
    dividendYield: raw(sd.dividendYield),
    beta: raw(sd.beta),
    high52: raw(sd.fiftyTwoWeekHigh),
    low52: raw(sd.fiftyTwoWeekLow),
    profitMargin: raw(fd.profitMargins),
    operatingMargin: raw(fd.operatingMargins),
    roe: raw(fd.returnOnEquity),
    revenueGrowth: raw(fd.revenueGrowth),
    earningsGrowth: raw(fd.earningsGrowth),
    debtToEquity: raw(fd.debtToEquity),          // Yahoo reports as a percentage (45 = 0.45x)
    freeCashflow: raw(fd.freeCashflow),
    operatingCashflow: raw(fd.operatingCashflow),
    targetMean: raw(fd.targetMeanPrice),
    targetHigh: raw(fd.targetHighPrice),
    targetLow: raw(fd.targetLowPrice),
    recommendationMean: raw(fd.recommendationMean), // 1 strong buy ... 5 sell
    recommendationKey: fd.recommendationKey || null,
    analysts: raw(fd.numberOfAnalystOpinions),
    nextEarnings: next ? new Date(next * 1000).toISOString().slice(0, 10) : null,
    lastEarnings: last ? new Date(last * 1000).toISOString().slice(0, 10) : null,
    source: "yahoo",
  };
}

async function fetchFinnhub(symbol) {
  const key = process.env.FINNHUB_KEY;
  const m = await fetchJson(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${key}`, { tries: 2 });
  await sleep(1100);
  const x = m?.metric || {};
  const pctToFrac = (v) => (Number.isFinite(v) ? v / 100 : null);
  return {
    trailingPE: x.peTTM ?? null,
    forwardPE: x.forwardPE ?? null,
    evToEbitda: x["enterpriseValue/ebitdaTTM"] ?? null,
    priceToBook: x.pbQuarterly ?? null,
    priceToSales: x.psTTM ?? null,
    profitMargin: pctToFrac(x.netProfitMarginTTM),
    operatingMargin: pctToFrac(x.operatingMarginTTM),
    roe: pctToFrac(x.roeTTM),
    revenueGrowth: pctToFrac(x.revenueGrowthQuarterlyYoy),
    earningsGrowth: pctToFrac(x.epsGrowthQuarterlyYoy),
    debtToEquity: Number.isFinite(x["totalDebt/totalEquityQuarterly"]) ? x["totalDebt/totalEquityQuarterly"] * 100 : null,
    high52: x["52WeekHigh"] ?? null,
    low52: x["52WeekLow"] ?? null,
    beta: x.beta ?? null,
  };
}

function mergeMissing(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (out[k] == null && v != null) out[k] = v;
  return out;
}

// The last four quarters' earnings per share against the analysts' consensus
// (Yahoo's earningsHistory module). Returns [{ quarter (fiscal quarter end,
// YYYY-MM-DD), actual, estimate, surprisePct }], oldest first. The report
// date itself is not in this module.
export async function fetchEarningsHistory(symbol) {
  return (await fetchResultsData(symbol)).history;
}

// The same plus the next results date and the consensus EPS forecast for it
// (calendarEvents), in one request.
export async function fetchResultsData(symbol) {
  const { cookie, crumb } = await yahooSession();
  const j = await fetchJson(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=earningsHistory,calendarEvents&crumb=${encodeURIComponent(crumb)}`, { headers: { cookie }, tries: 2 });
  const r = j?.quoteSummary?.result?.[0];
  const h = r?.earningsHistory?.history;
  if (!Array.isArray(h)) throw new Error("no result");
  return { history: parseEarningsHistory(h), next: parseNextResults(r?.calendarEvents?.earnings) };
}

export function parseNextResults(e) {
  if (!e) return null;
  const now = Date.now() / 1000;
  const t = (e.earningsDate || []).map(raw).filter(Boolean).sort((a, b) => a - b).find((x) => x > now - 86400);
  const avg = raw(e.earningsAverage), lo = raw(e.earningsLow), hi = raw(e.earningsHigh);
  if (!t && avg == null) return null;
  return { date: t ? new Date(t * 1000).toISOString().slice(0, 10) : null, epsEstimate: avg, epsLow: lo, epsHigh: hi };
}

export function parseEarningsHistory(h = []) {
  return h.map((x) => {
    const q = raw(x.quarter), actual = raw(x.epsActual), estimate = raw(x.epsEstimate);
    let sp = raw(x.surprisePercent);
    if (sp == null && actual != null && estimate) sp = (actual - estimate) / Math.abs(estimate);
    return { quarter: q ? new Date(q * 1000).toISOString().slice(0, 10) : null, actual, estimate, surprisePct: sp == null ? null : Math.round(sp * 1000) / 10 };
  }).filter((x) => x.quarter && x.actual != null && x.estimate != null).sort((a, b) => (a.quarter < b.quarter ? -1 : 1));
}

// Annual accounts, the last four fiscal years (Yahoo fundamentals-timeseries;
// for the Buffett lens, src/buffett.js). Returns the raw JSON.
export async function fetchTimeseries(symbol, types) {
  const { cookie, crumb } = await yahooSession();
  const now = Math.floor(Date.now() / 1000), p1 = now - 6 * 366 * 86400;
  const t = types.map((x) => "annual" + x).join(",");
  return fetchJson(`https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${t}&period1=${p1}&period2=${now}&crumb=${encodeURIComponent(crumb)}`, { headers: { cookie }, tries: 2 });
}

// Past results dates with their time of day (results preview, 12 Nov 2026):
// Yahoo's earnings module (reportedDate for the last four quarters with EPS)
// plus its earnings visualization (older, sparser, covers half-yearly UK
// reporters). Returns [{ date (exchange-local YYYY-MM-DD), after (true: after
// the close, so the market reacts the next session) }], oldest first.
export async function fetchReportedDates(symbol) {
  const { cookie, crumb } = await yahooSession();
  const ts = [];
  try {
    const j = await fetchJson(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=earnings&crumb=${encodeURIComponent(crumb)}`, { headers: { cookie }, tries: 2 });
    for (const q of j?.quoteSummary?.result?.[0]?.earnings?.earningsChart?.quarterly ?? []) { const t = raw(q?.reportedDate); if (t) ts.push(t * 1000); }
  } catch { /* the other source may still have dates */ }
  try {
    const body = { offset: 0, size: 12, sortField: "startdatetime", sortType: "DESC", entityIdType: "earnings", includeFields: ["ticker", "startdatetime"], query: { operator: "eq", operands: ["ticker", symbol] } };
    const j = await fetchJson(`https://query2.finance.yahoo.com/v1/finance/visualization?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body), tries: 2 });
    for (const r of j?.finance?.result?.[0]?.documents?.[0]?.rows ?? []) { const t = Date.parse(r?.[1]); if (Number.isFinite(t)) ts.push(t); }
  } catch { /* optional */ }
  return reportedSessions(ts, symbol);
}

// Timestamps (ms) to exchange-local dates and before/after the close
// (London 16:30, New York 16:00; Europe 17:30). One entry per date.
export function reportedSessions(ts = [], symbol = "") {
  const uk = /\.L$/.test(symbol), eu = !uk && /\.[A-Z]+$/.test(symbol);
  const tz = uk ? "Europe/London" : eu ? "Europe/Paris" : "America/New_York", close = uk ? 990 : eu ? 1050 : 960;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const by = new Map();
  for (const t of ts) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    // A bare midnight-UTC stamp is a date with no time: keep the UTC date,
    // timing unknown (null).
    if (t % 864e5 === 0) { const d = new Date(t).toISOString().slice(0, 10); if (!by.has(d)) by.set(d, null); continue; }
    const date = `${p.year}-${p.month}-${p.day}`, after = +p.hour * 60 + +p.minute >= close;
    // Several stamps on one day (a call later in the day): before the close wins.
    by.set(date, by.has(date) && by.get(date) != null ? by.get(date) && after : after);
  }
  return [...by].map(([date, after]) => ({ date, after })).sort((a, b) => (a.date < b.date ? -1 : 1));
}
