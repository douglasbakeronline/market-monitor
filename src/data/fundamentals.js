// Company fundamentals and analyst data. Yahoo's quoteSummary is the primary
// source (no key, covers US and UK). It needs a session cookie and "crumb".
// If FINNHUB_KEY is set, Finnhub fills any gaps for US tickers.
import { UA, fetchJson } from "./http.js";
import { sleep } from "../util.js";

let session = null;

async function yahooSession() {
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

export function parseYahooSummary(r) {
  const p = r.price || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ap = r.assetProfile || {};
  const earn = (r.calendarEvents?.earnings?.earningsDate || []).map(raw).filter(Boolean).sort((a, b) => a - b);
  const now = Date.now() / 1000;
  const next = earn.find((t) => t > now - 86400) ?? null;
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
    targetMean: raw(fd.targetMeanPrice),
    targetHigh: raw(fd.targetHighPrice),
    targetLow: raw(fd.targetLowPrice),
    recommendationMean: raw(fd.recommendationMean), // 1 strong buy ... 5 sell
    recommendationKey: fd.recommendationKey || null,
    analysts: raw(fd.numberOfAnalystOpinions),
    nextEarnings: next ? new Date(next * 1000).toISOString().slice(0, 10) : null,
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
