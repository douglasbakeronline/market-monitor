// Index constituents (S&P 500 and FTSE 100) from Wikipedia's tables, cached in
// data/constituents.json so a Wikipedia hiccup never stops the scan.
import { fetchJson } from "./http.js";
import { readJson, writeJson } from "../state.js";

const PAGES = {
  SP500: { page: "List_of_S&P_500_companies", symbolCol: /symbol|ticker/i, nameCol: /security|company/i, sectorCol: /gics sector|sector/i },
  FTSE100: { page: "FTSE_100_Index", symbolCol: /ticker|epic|symbol/i, nameCol: /company/i, sectorCol: /sector|industry/i },
};

const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "").replace(/\[\d+\]/g, "").trim();

// Pull the first wikitable whose header has symbol + name columns.
export function parseTable(html, spec) {
  const tables = html.match(/<table[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/g) || [];
  for (const t of tables) {
    const rows = t.match(/<tr[\s\S]*?<\/tr>/g) || [];
    if (rows.length < 20) continue;
    const head = (rows[0].match(/<th[\s\S]*?<\/th>/g) || []).map(decode);
    const si = head.findIndex((h) => spec.symbolCol.test(h)), ni = head.findIndex((h) => spec.nameCol.test(h)), ci = head.findIndex((h) => spec.sectorCol.test(h));
    if (si < 0 || ni < 0) continue;
    const out = [];
    for (const r of rows.slice(1)) {
      const cells = (r.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(decode);
      if (cells.length <= Math.max(si, ni)) continue;
      out.push({ ticker: cells[si], name: cells[ni], sector: ci >= 0 ? cells[ci] : null });
    }
    if (out.length >= 20) return out;
  }
  return [];
}

export const toYahoo = (index, ticker) => {
  const t = ticker.replace(/\s+/g, "").replace(/\.+$/, "");
  return index === "FTSE100" ? `${t.replace(/\./g, "-")}.L` : t.replace(/\./g, "-");
};

export async function fetchConstituents() {
  const cached = await readJson("data/constituents.json", null);
  const fresh = cached && Date.now() - Date.parse(cached.updated) < 7 * 86400000;
  if (fresh) return cached;
  const out = { updated: new Date().toISOString(), indices: {} };
  for (const [index, spec] of Object.entries(PAGES)) {
    try {
      const j = await fetchJson(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(spec.page)}&prop=text&format=json&formatversion=2`, { tries: 2 });
      const rows = parseTable(j?.parse?.text || "", spec);
      const min = index === "SP500" ? 480 : 95;
      if (rows.length < min) throw new Error(`only ${rows.length} rows parsed`);
      out.indices[index] = rows.map((r) => ({ ...r, symbol: toYahoo(index, r.ticker) }));
    } catch (e) {
      console.warn(`Constituents for ${index} failed (${e.message}); using cache.`);
      if (cached?.indices?.[index]) out.indices[index] = cached.indices[index];
    }
  }
  if (Object.keys(out.indices).length) await writeJson("data/constituents.json", out, true);
  return out;
}
