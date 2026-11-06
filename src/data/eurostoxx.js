// Euro Stoxx 50: fallback list and helpers. The scan reads the live list from
// Wikipedia (like the S&P 500 and FTSE 100); this list is used when that page
// can't be parsed, and to give each name its Yahoo symbol and GICS sector.
// Matches the live list of 6 Nov 2026. The index is reviewed each September; check the scan log for "not in the
// fallback list" lines and update here when names change.
export const EUROSTOXX_FALLBACK = [
  ["ADS.DE", "Adidas", "Consumer Discretionary"], ["ADYEN.AS", "Adyen", "Financials"], ["AD.AS", "Ahold Delhaize", "Consumer Staples"],
  ["AI.PA", "Air Liquide", "Materials"], ["AIR.PA", "Airbus", "Industrials"], ["ALV.DE", "Allianz", "Financials"],
  ["ABI.BR", "Anheuser-Busch InBev", "Consumer Staples"], ["ARGX.BR", "argenx", "Health Care"], ["ASML.AS", "ASML Holding", "Information Technology"],
  ["CS.PA", "AXA", "Financials"], ["BAS.DE", "BASF", "Materials"], ["BAYN.DE", "Bayer", "Health Care"],
  ["BBVA.MC", "Banco Bilbao Vizcaya Argentaria", "Financials"], ["SAN.MC", "Banco Santander", "Financials"], ["BMW.DE", "BMW", "Consumer Discretionary"],
  ["BNP.PA", "BNP Paribas", "Financials"], ["BN.PA", "Danone", "Consumer Staples"], ["DB1.DE", "Deutsche Börse", "Financials"],
  ["DBK.DE", "Deutsche Bank", "Financials"], ["DHL.DE", "DHL Group", "Industrials"], ["DTE.DE", "Deutsche Telekom", "Communication Services"],
  ["ENEL.MI", "Enel", "Utilities"], ["ENI.MI", "Eni", "Energy"], ["EL.PA", "EssilorLuxottica", "Health Care"],
  ["RACE.MI", "Ferrari", "Consumer Discretionary"], ["RMS.PA", "Hermès", "Consumer Discretionary"], ["IBE.MC", "Iberdrola", "Utilities"],
  ["ITX.MC", "Inditex", "Consumer Discretionary"], ["IFX.DE", "Infineon Technologies", "Information Technology"], ["INGA.AS", "ING Group", "Financials"],
  ["ISP.MI", "Intesa Sanpaolo", "Financials"], ["OR.PA", "L'Oréal", "Consumer Staples"], ["MC.PA", "LVMH", "Consumer Discretionary"],
  ["MBG.DE", "Mercedes-Benz Group", "Consumer Discretionary"], ["MUV2.DE", "Munich Re", "Financials"], ["NDA-FI.HE", "Nordea", "Financials"],
  ["PRX.AS", "Prosus", "Consumer Discretionary"], ["RHM.DE", "Rheinmetall", "Industrials"], ["SAF.PA", "Safran", "Industrials"],
  ["SGO.PA", "Saint-Gobain", "Industrials"], ["SAN.PA", "Sanofi", "Health Care"], ["SAP.DE", "SAP", "Information Technology"],
  ["SU.PA", "Schneider Electric", "Industrials"], ["SIE.DE", "Siemens", "Industrials"], ["ENR.DE", "Siemens Energy", "Industrials"],
  ["TTE.PA", "TotalEnergies", "Energy"], ["UCG.MI", "UniCredit", "Financials"], ["DG.PA", "Vinci", "Industrials"],
  ["ENGI.PA", "Engie", "Utilities"], ["NOKIA.HE", "Nokia", "Information Technology"],
].map(([symbol, name, sector]) => ({ ticker: symbol.replace(/\.[A-Z]+$/, ""), name, sector, symbol }));

// Main listing (or country) to Yahoo suffix.
const SUFFIX = [[/xetra|frankfurt|germany|deutsche/i, ".DE"], [/paris|france/i, ".PA"], [/amsterdam|netherlands/i, ".AS"],
  [/milan|borsa italiana|italy|italian/i, ".MI"], [/madrid|bme|spain|spanish/i, ".MC"], [/brussels|belgium/i, ".BR"],
  [/helsinki|finland/i, ".HE"], [/dublin|ireland/i, ".IR"], [/lisbon|portugal/i, ".LS"]];
const KNOWN_SUFFIX = /\.(DE|PA|AS|MI|MC|BR|HE|IR|LS)$/;

// Words that differ between sources ("SE", "N.V.", accents, punctuation).
const LEGAL = new Set(["se", "sa", "ag", "nv", "spa", "plc", "group", "holding", "holdings", "kgaa", "co", "the", "ab", "oyj"]);
export const nameKey = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\./g, "")
  .split(/[^a-z0-9]+/).filter((w) => w && !LEGAL.has(w)).join("");

// Wikipedia's industry wording to GICS (only used for names not in the fallback).
const INDUSTRY = [[/bank|insur|financ|payment|exchange|asset/i, "Financials"], [/semiconductor|software|technolog/i, "Information Technology"],
  [/pharma|health|biotech|medical/i, "Health Care"], [/oil|gas|energy(?! equipment)/i, "Energy"], [/utilit|electric/i, "Utilities"],
  [/chemical|material|steel|mining/i, "Materials"], [/telecom|media/i, "Communication Services"], [/food|beverage|brew|retail.*food|personal care|cosmetic/i, "Consumer Staples"],
  [/auto|car|apparel|cloth|luxury|retail|internet|leisure/i, "Consumer Discretionary"], [/aerospace|defen|industrial|engineering|construction|logistic|transport|electrical/i, "Industrials"],
  [/real estate|reit/i, "Real Estate"]];
export const industryToGics = (s) => INDUSTRY.find(([re]) => re.test(s || ""))?.[1] ?? null;

// Wikipedia rows ({ ticker, name, sector, exchange }) to scan constituents.
// Names in the fallback list keep its symbol and sector; others get a symbol
// from the main listing. Rows we can't place are returned in `unplaced`.
export function euroStoxxFromRows(rows) {
  const byName = new Map(EUROSTOXX_FALLBACK.map((c) => [nameKey(c.name), c]));
  const byTicker = new Map(EUROSTOXX_FALLBACK.map((c) => [c.ticker.toUpperCase(), c]));
  const out = [], unplaced = [], fresh = [];
  for (const r of rows) {
    const t = String(r.ticker ?? "").trim().toUpperCase().replace(/\s+/g, "");
    const hit = byName.get(nameKey(r.name)) ?? byTicker.get(t.replace(KNOWN_SUFFIX, ""));
    if (hit) { out.push({ ...hit }); continue; }
    const suffix = KNOWN_SUFFIX.test(t) ? "" : SUFFIX.find(([re]) => re.test(r.exchange || ""))?.[1];
    if (!t || suffix == null) { unplaced.push(r.name || t); continue; }
    const symbol = KNOWN_SUFFIX.test(t) ? t : t.replace(/\./g, "-") + suffix;
    out.push({ ticker: t.replace(KNOWN_SUFFIX, ""), name: r.name, sector: industryToGics(r.sector), symbol });
    fresh.push(symbol);
  }
  const seen = new Set();
  return { list: out.filter((c) => !seen.has(c.symbol) && seen.add(c.symbol)), unplaced, fresh };
}
