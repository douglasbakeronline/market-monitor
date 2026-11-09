// Nasdaq 100: only the names the other indices don't already cover. About 80
// of its 100 are in the S&P 500; the rest are mostly foreign companies listed
// in New York (Arm, MercadoLibre, PDD, Shopify, Thomson Reuters) and a few US
// names outside the S&P. Some are also in the FTSE 100 or Euro Stoxx 50 under
// their home listing (AstraZeneca, ASML), which we keep instead of the ADR.
import { nameKey, industryToGics } from "./eurostoxx.js";
import { gicsSector } from "../sectorValue.js";

// Company key: share classes and US legal words ignored too ("Alphabet Inc. (Class C)").
const key = (s) => nameKey(String(s ?? "").replace(/\s*\(?class [a-z]\)?/gi, "").replace(/\b(inc|corp|corporation|ltd|limited|company)\b\.?/gi, ""));
const homeTicker = (symbol) => String(symbol ?? "").replace(/\.[A-Z]+$/, "").replace(/-/g, ".").toUpperCase();

// rows: [{ ticker, name, sector }] from Wikipedia; others: constituents of the
// other indices ({ symbol, name }). Returns { list, dropped } where dropped
// counts names already covered.
export function nasdaqExtras(rows, others) {
  const symbols = new Set(others.map((c) => c.symbol));
  const names = new Set(others.map((c) => key(c.name)));
  // A UK or European home listing with the same ticker as the ADR (AZN, ASML).
  const foreign = new Set(others.filter((c) => /\.[A-Z]+$/.test(c.symbol)).map((c) => homeTicker(c.symbol)));
  const list = [], seen = new Set();
  let dropped = 0;
  for (const r of rows) {
    const t = String(r.ticker ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/\.+$/, "");
    if (!/^[A-Z][A-Z0-9.]*$/.test(t)) continue;
    const symbol = t.replace(/\./g, "-");
    if (symbols.has(symbol) || names.has(key(r.name)) || foreign.has(t) || seen.has(symbol)) { dropped++; continue; }
    seen.add(symbol);
    // Wikipedia has used both GICS sectors and ICB industries for this table.
    const sector = gicsSector(r.sector) ?? industryToGics(r.sector) ?? (r.sector || null);
    list.push({ ticker: t, name: r.name, sector, symbol });
  }
  return { list, dropped };
}
