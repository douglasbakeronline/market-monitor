// Index constituents (S&P 500, FTSE 100, Euro Stoxx 50 and the Nasdaq 100 names
// the others miss) from Wikipedia's tables, cached in
// data/constituents.json so a Wikipedia hiccup never stops the scan.
import { fetchJson } from "./http.js";
import { readJson, writeJson } from "../state.js";
import { EUROSTOXX_FALLBACK, euroStoxxFromRows } from "./eurostoxx.js";
import { nasdaqExtras } from "./nasdaq.js";

const PAGES = {
  SP500: { page: "List_of_S&P_500_companies", symbolCol: /symbol|ticker/i, nameCol: /security|company/i, sectorCol: /gics sector|sector/i },
  FTSE100: { page: "FTSE_100_Index", symbolCol: /ticker|epic|symbol/i, nameCol: /company/i, sectorCol: /sector|industry/i },
  EUROSTOXX50: { page: "EURO_STOXX_50", symbolCol: /ticker|symbol/i, nameCol: /^name|company/i, sectorCol: /industry|sector/i, exchangeCol: /listing|exchange|registered|country/i },
  // Last, so it can drop the names the other three already cover.
  NASDAQ100: { page: "List_of_NASDAQ-100_companies", symbolCol: /ticker|symbol/i, nameCol: /company|security/i, sectorCol: /gics sector|icb industry|industry|sector/i },
};
const MIN_ROWS = { SP500: 480, FTSE100: 95, EUROSTOXX50: 45, NASDAQ100: 95 };

const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "").replace(/\[\d+\]/g, "").trim();

// Pull the first wikitable whose header has symbol + name columns.
export function parseTable(html, spec) {
  const tables = html.match(/<table[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/g) || [];
  for (const t of tables) {
    const rows = t.match(/<tr[\s\S]*?<\/tr>/g) || [];
    if (rows.length < 20) continue;
    const head = (rows[0].match(/<th[\s\S]*?<\/th>/g) || []).map(decode);
    const si = head.findIndex((h) => spec.symbolCol.test(h)), ni = head.findIndex((h) => spec.nameCol.test(h)), ci = head.findIndex((h) => spec.sectorCol.test(h));
    const xi = spec.exchangeCol ? head.findIndex((h) => spec.exchangeCol.test(h)) : -1;
    if (si < 0 || ni < 0) continue;
    const out = [];
    for (const r of rows.slice(1)) {
      const cells = (r.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(decode);
      if (cells.length <= Math.max(si, ni)) continue;
      out.push({ ticker: cells[si], name: cells[ni], sector: ci >= 0 ? cells[ci] : null, ...(xi >= 0 ? { exchange: cells[xi] } : {}) });
    }
    if (out.length >= (spec.minTable ?? 20)) return out;
  }
  return [];
}

export const toYahoo = (index, ticker) => {
  const t = ticker.replace(/\s+/g, "").replace(/\.+$/, "");
  return index === "FTSE100" ? `${t.replace(/\./g, "-")}.L` : t.replace(/\./g, "-");
};

export async function fetchConstituents() {
  const cached = await readJson("data/constituents.json", null);
  // A cache from before an index was added doesn't count as fresh.
  const fresh = cached && Object.keys(PAGES).every((k) => cached.indices?.[k]?.length) && Date.now() - Date.parse(cached.updated) < 7 * 86400000;
  if (fresh) return cached;
  const out = { updated: new Date().toISOString(), indices: {} };
  for (const [index, spec] of Object.entries(PAGES)) {
    try {
      const j = await fetchJson(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(spec.page)}&prop=text&format=json&formatversion=2`, { tries: 2 });
      const rows = parseTable(j?.parse?.text || "", spec);
      if (rows.length < MIN_ROWS[index]) throw new Error(`only ${rows.length} rows parsed`);
      if (index === "EUROSTOXX50") {
        const es = euroStoxxFromRows(rows);
        if (es.unplaced.length) console.warn(`Euro Stoxx 50: could not place ${es.unplaced.join(", ")}.`);
        if (es.fresh.length) console.log(`Euro Stoxx 50: not in the fallback list (check symbol and sector): ${es.fresh.join(", ")}.`);
        if (es.list.length < MIN_ROWS[index]) throw new Error(`only ${es.list.length} placed`);
        out.indices[index] = es.list;
      } else if (index === "NASDAQ100") {
        const nd = nasdaqExtras(rows, ["SP500", "FTSE100", "EUROSTOXX50"].flatMap((k) => out.indices[k] ?? []));
        console.log(`Nasdaq 100: ${nd.list.length} names not in the other indices (${nd.dropped} already covered): ${nd.list.map((c) => c.symbol).join(", ")}.`);
        if (nd.dropped < 60) throw new Error(`only ${nd.dropped} overlap the others (other lists missing?)`);
        out.indices[index] = nd.list;
      } else out.indices[index] = rows.map((r) => ({ ...r, symbol: toYahoo(index, r.ticker) }));
    } catch (e) {
      console.warn(`Constituents for ${index} failed (${e.message}); using cache.`);
      if (cached?.indices?.[index]) out.indices[index] = cached.indices[index];
      else if (index === "EUROSTOXX50") out.indices[index] = EUROSTOXX_FALLBACK;
    }
  }
  if (Object.keys(out.indices).length) await writeJson("data/constituents.json", out, true);
  return out;
}
