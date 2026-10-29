// Batch quotes (50 symbols per call) for the scanner's quick pass.
import { fetchJson } from "./http.js";
import { yahooSession } from "./fundamentals.js";
import { sleep } from "../util.js";

const FIELDS = "shortName,longName,currency,regularMarketPrice,regularMarketChangePercent,marketCap,trailingPE,forwardPE,priceToBook,fiftyTwoWeekHigh,fiftyTwoWeekLow,fiftyDayAverage,twoHundredDayAverage,averageAnalystRating,trailingAnnualDividendYield,earningsTimestamp,earningsTimestampStart,epsTrailingTwelveMonths,epsForward";

export async function fetchQuotes(symbols, batch = 50) {
  const { cookie, crumb } = await yahooSession();
  const out = {};
  for (let i = 0; i < symbols.length; i += batch) {
    const chunk = symbols.slice(i, i + batch);
    try {
      const j = await fetchJson(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(","))}&fields=${FIELDS}&crumb=${encodeURIComponent(crumb)}`, { headers: { cookie }, tries: 3 });
      for (const q of j?.quoteResponse?.result || []) out[q.symbol] = q;
    } catch (e) { console.warn(`Quote batch ${i / batch + 1} failed: ${e.message}`); }
    await sleep(600);
  }
  return out;
}

// Map a v7 quote onto the fundamentals shape used by the scorer (partial).
export function quoteToFundamentals(q) {
  if (!q) return null;
  const rating = parseFloat(String(q.averageAnalystRating || "").split(" ")[0]);
  const et = q.earningsTimestamp || q.earningsTimestampStart;
  const next = et && et * 1000 > Date.now() - 86400000 ? new Date(et * 1000).toISOString().slice(0, 10) : null;
  return {
    name: q.longName || q.shortName || null, currency: q.currency || null, marketCap: q.marketCap ?? null,
    trailingPE: q.trailingPE ?? null, forwardPE: q.forwardPE ?? null, priceToBook: q.priceToBook ?? null,
    dividendYield: q.trailingAnnualDividendYield ?? null,
    recommendationMean: Number.isFinite(rating) ? rating : null, nextEarnings: next, source: "quote",
  };
}
