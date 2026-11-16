// VWRP's biggest holdings, for PLAN.coreHoldings (Key dates and the pots
// look-through). Refreshed by hand each quarter with tools/core-holdings.mjs,
// run on the runners (16 Nov 2026): it reads stockanalysis.com's holdings page,
// which embeds the rows as a script literal.
import { PLAN } from "./plan.js";

// Listings outside the US: the symbol the monitor and scan already use.
// `extra` names are fetched as extra quotes in the scan (not index members).
const FOREIGN = {
  "@TPE-2330": { symbol: "TSM", name: "TSMC", extra: true },
  "@KRX-005930": { symbol: "005930.KS", name: "Samsung Electronics", extra: true },
  "@KRX-000660": { symbol: "000660.KS", name: "SK hynix", extra: true },
  "@AMS-ASML": { symbol: "ASML.AS", name: "ASML" },
};
// Share classes of one company, counted once under the plan's symbol.
const SAME = { GOOG: "GOOGL" };

export function parseHoldingsPage(html = "") {
  const rows = [];
  const re = /\{no:\d+,s:"([^"]+)",n:"([^"]+)",holdingWeight:([\d.]+)/g;
  for (const m of html.matchAll(re)) rows.push({ symbol: m[1], name: m[2], weight: Number(m[3]) });
  const date = html.match(/\bdate:"([A-Z][a-z]{2} \d{1,2}, \d{4})"/)?.[1] ?? null;
  const count = Number(html.match(/\bcount:(\d+)/)?.[1]) || null;
  return { rows, date, count };
}

const tidy = (n) => n.replace(/,? (Inc\.|Corporation|Incorporated|Company|Co\., Ltd\.|plc|N\.V\.|& Co\.)$/i, "").trim();

export function toCoreHoldings(rows, { top = 25, known = PLAN.coreHoldings ?? [] } = {}) {
  const by = new Map(), unmapped = [];
  for (const r of rows) {
    let h;
    if (r.symbol.startsWith("$")) {
      const s = r.symbol.slice(1).replace(/\./g, "-");
      h = { symbol: SAME[s] ?? s };
    } else if (FOREIGN[r.symbol]) h = { ...FOREIGN[r.symbol] };
    else { unmapped.push(`${r.symbol} ${r.name}`); continue; }
    const k = known.find((x) => x.symbol === h.symbol);
    h.name = k?.name ?? h.name ?? tidy(r.name);
    if (k?.extra) h.extra = true;
    const prev = by.get(h.symbol);
    if (prev) prev.weight = Math.round((prev.weight + r.weight) * 100) / 100;
    else by.set(h.symbol, { ...h, weight: r.weight });
  }
  const out = [...by.values()].sort((a, b) => b.weight - a.weight).slice(0, top)
    .map(({ symbol, name, weight, extra }) => (extra ? { symbol, name, weight, extra } : { symbol, name, weight }));
  out.unmapped = unmapped;
  return out;
}
