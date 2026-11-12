// Sector-relative valuation (research log 2 Nov 2026; live in the score since
// Douglas agreed on 10 Nov). The scan works out each sector's median P/E and
// EV/EBITDA; each stock is scored against its peers, with a cyclical cap.
import { median, r1 } from "./util.js";

// The scan mixes S&P 500 GICS sectors, FTSE 100 ICB sectors and Yahoo's own
// sector names (research list, deepened stocks). Map them onto GICS's eleven.
const GICS = ["Information Technology", "Financials", "Health Care", "Consumer Discretionary", "Consumer Staples", "Industrials",
  "Materials", "Energy", "Utilities", "Real Estate", "Communication Services"];
const ALIAS = {
  // Yahoo
  "Technology": "Information Technology", "Financial Services": "Financials", "Healthcare": "Health Care",
  "Consumer Cyclical": "Consumer Discretionary", "Consumer Defensive": "Consumer Staples", "Basic Materials": "Materials",
  // FTSE (ICB)
  "Banks": "Financials", "Investment Banking and Brokerage Services": "Financials", "Life Insurance": "Financials",
  "Non-life Insurance": "Financials", "Finance and Credit Services": "Financials", "Closed End Investments": "Financials",
  "Gas, Water and Multi-utilities": "Utilities", "Electricity": "Utilities", "Waste and Disposal Services": "Utilities",
  "Real Estate Investment Trusts": "Real Estate", "Real Estate Investment and Services": "Real Estate",
  "Personal Care, Drug and Grocery Stores": "Consumer Staples", "Beverages": "Consumer Staples", "Tobacco": "Consumer Staples", "Food Producers": "Consumer Staples",
  "Industrial Support Services": "Industrials", "Aerospace and Defense": "Industrials", "Industrial Engineering": "Industrials",
  "Electronic and Electrical Equipment": "Industrials", "General Industrials": "Industrials", "Construction and Materials": "Industrials",
  "Industrial Transportation": "Industrials",
  "Industrial Metals and Mining": "Materials", "Precious Metals and Mining": "Materials", "Chemicals": "Materials", "Industrial Materials": "Materials",
  "Software and Computer Services": "Information Technology", "Technology Hardware and Equipment": "Information Technology",
  "Retailers": "Consumer Discretionary", "Travel and Leisure": "Consumer Discretionary", "Household Goods and Home Construction": "Consumer Discretionary",
  "Leisure Goods": "Consumer Discretionary", "Consumer Services": "Consumer Discretionary", "Personal Goods": "Consumer Discretionary",
  "Automobiles and Parts": "Consumer Discretionary",
  "Non-Renewable Energy": "Energy", "Renewable Energy": "Energy", "Oil, Gas and Coal": "Energy",
  "Telecommunications Service Providers": "Communication Services", "Telecommunications Equipment": "Communication Services", "Media": "Communication Services",
  "Pharmaceuticals, Biotechnology and Marijuana Producers": "Health Care", "Medical Equipment and Services": "Health Care", "Health Care Providers": "Health Care",
};
export const gicsSector = (s) => (!s ? null : GICS.includes(s) ? s : ALIAS[s] ?? null);

// Industries where profits swing with the cycle, so a low P/E often marks peak
// earnings (McKinsey, "How to value cyclical companies"). Energy and Materials
// count as a whole; elsewhere it needs the industry (or the FTSE sector).
const CYCLICAL_SECTORS = ["Energy", "Materials"];
const CYCLICAL_INDUSTRY = /semiconductor|computer hardware|data storage|auto (manufacturers|parts)|automobiles|airlines|steel|aluminium|aluminum|copper|gold|silver|metals|mining|chemical|agricultural inputs|oil|gas e&p|coal|homebuild|residential construction|home construction|building materials|marine shipping|trucking/i;
export function isCyclical(sector, industry) {
  if (CYCLICAL_SECTORS.includes(gicsSector(sector))) return true;
  return CYCLICAL_INDUSTRY.test(industry || "") || CYCLICAL_INDUSTRY.test(sector || "");
}

export const MIN_PEERS = 8, MIN_PEERS_EV = 5;

// rows: [{ sector, forwardPE, trailingPE, evToEbitda, trust }] -> { sector: { n, forwardPE, trailingPE, evToEbitda, nEv } }
// Only positive multiples count; investment trusts are left out (not companies).
export function sectorMedians(rows) {
  const by = {};
  for (const r of rows) {
    const s = gicsSector(r.sector);
    if (!s || r.trust) continue;
    const b = (by[s] ??= { fwd: [], trl: [], pe: [], ev: [] });
    if (r.forwardPE > 0) b.fwd.push(r.forwardPE);
    if (r.trailingPE > 0) b.trl.push(r.trailingPE);
    const pe = r.forwardPE > 0 ? r.forwardPE : r.trailingPE > 0 ? r.trailingPE : null;
    if (pe) b.pe.push(pe);
    if (r.evToEbitda > 0) b.ev.push(r.evToEbitda);
  }
  const out = {};
  for (const [s, b] of Object.entries(by)) {
    if (b.pe.length < MIN_PEERS) continue;
    out[s] = {
      n: b.pe.length,
      pe: r1(median(b.pe)),
      forwardPE: b.fwd.length >= MIN_PEERS ? r1(median(b.fwd)) : null,
      trailingPE: b.trl.length >= MIN_PEERS ? r1(median(b.trl)) : null,
      evToEbitda: b.ev.length >= MIN_PEERS_EV ? r1(median(b.ev)) : null, nEv: b.ev.length,
    };
  }
  return out;
}

// Region for peer medians: US vs Europe (UK and Euro Stoxx together). UK and
// European multiples run lower (Financials: US 13, Europe under 10 on 6 Nov),
// and Europe alone has too few stocks per sector, so the two are pooled.
const EU_SUFFIX = /\.(DE|PA|AS|MI|MC|BR|HE|LS|VI|IR|CO|ST|OL|SW)$/;
export const marketOf = (symbol) => (/\.L$/.test(symbol || "") ? "UK" : EU_SUFFIX.test(symbol || "") ? "EU" : "US");
export const regionOf = (market) => (market === "UK" || market === "EU" ? "Europe" : "US");

// rows as for sectorMedians, plus market ("US", "UK", "EU") -> { US: medians, Europe: medians }.
export function regionMedians(rows) {
  const out = {};
  for (const reg of ["US", "Europe"]) out[reg] = sectorMedians(rows.filter((r) => regionOf(r.market) === reg));
  return out;
}

// The peer context longTerm() takes as its third argument, or null when the
// stock's sector has too few peers to compare with. With regional medians and
// a market, the stock is compared with its own region's sector when that has
// enough peers (MIN_PEERS), else with the pooled median. EV/EBITDA stays on the
// fixed bands: the scan only fetches it for the ~100 deepened stocks, which
// are picked for high scores (cheap), so their median would be biased low.
export function peerFor(f, medians, regional = null, market = null) {
  const sector = gicsSector(f?.sector);
  if (!sector) return null;
  const region = market ? regionOf(market) : null;
  const rm = region && regional?.[region]?.[sector];
  const m = rm || medians?.[sector];
  if (!m) return null;
  return { sector, region: rm ? region : null, n: m.n, forwardPE: m.forwardPE, trailingPE: m.trailingPE, pe: m.pe, cyclical: isCyclical(f?.sector, f?.industry) };
}

// Value pillar cap for cyclicals: a P/E alone can't make a cyclical cheap.
export const CYCLICAL_VALUE_CAP = 60;

// Attach a REIT's cash-flow score summary (research.js reitLongTerm; the live
// score since 12 Nov) to a sectorValueNote() summary, with one sentence on what
// the P/E-based score would have been (pe: { score, verdict, value }). Mutates sv.
export function withReitScore(sv, rs, pe = null) {
  if (!sv || !rs) return sv;
  sv.reit = rs;
  if (pe?.score != null) {
    const v = pe.value ?? pe.pillars?.find((p) => p.key === "value")?.score ?? null;
    sv.reitPe = { score: pe.score, verdict: pe.verdict, value: v };
    sv.note = `${sv.note} On P/E instead it would be Value ${v ?? "n/a"}, score ${pe.score} (${pe.verdict}).`.trim();
  }
  return sv;
}

// Summary attached to each stock: what peers say, and what would change.
// now = the old-rule longTerm(f, t); alt = the live longTermLive(f, t, peer).
export function sectorValueNote(f, peer, now, alt, reit = null) {
  if (!peer || !now || now.score == null || !alt) return null;
  const pe = f?.forwardPE > 0 ? f.forwardPE : f?.trailingPE > 0 ? f.trailingPE : null;
  const ratio = pe && peer.pe ? pe / peer.pe : null;
  const vNow = now.pillars.find((p) => p.key === "value")?.score ?? null, altValue = alt.pillars.find((p) => p.key === "value"), vAlt = altValue?.score ?? null;
  const parts = [];
  if (ratio != null) {
    const d = Math.round((ratio - 1) * 100);
    parts.push(`P/E ${pe.toFixed(1)} vs the ${peer.region ? (peer.region === "US" ? "US " : "European ") : ""}${peer.sector} median of ${peer.pe.toFixed(1)} (${peer.n} stocks): ${Math.abs(d) < 5 ? "in line with peers" : `${Math.abs(d)}% ${d < 0 ? "below" : "above"}`}${alt.reit ? " (not used for REITs)" : ""}.`);
  }
  if (peer.cyclical && (altValue?.capped || (ratio != null && ratio < 1))) parts.push(`Cyclical: a low P/E may mark peak earnings${altValue?.capped ? `, so value is capped at ${CYCLICAL_VALUE_CAP}` : ""}.`);
  if (peer.sector === "Real Estate" && !reit) parts.push("REITs are better judged on funds from operations than P/E.");
  if (reit?.note) parts.push(alt.reit ? `Scored on cash flow (since 12 Nov): ${reit.note}` : `REIT view (not in the score yet: too few fully scored REITs for a median): ${reit.note}`);
  if (vAlt != null && vNow != null) parts.push(`Value scored against peers: ${vAlt}${vAlt !== vNow ? ` (${vNow} on the old fixed bands)` : ""}.`);
  return {
    sector: peer.sector, region: peer.region ?? null, n: peer.n, pe: r1(pe), medianPE: peer.pe, ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
    cyclical: peer.cyclical, value: vAlt, valueNow: vNow, score: alt.score, verdict: alt.verdict, changed: alt.verdict !== now.verdict,
    note: parts.join(" "),
  };
}

// REITs (in the score since 12 Nov, research.js longTermScored): property depreciation cuts reported
// earnings, so P/E overstates their price. Price / operating cash flow is a
// rough stand-in for P/FFO, the measure REITs are usually judged on.
// REITs only: property services firms (CBRE) are Real Estate but not REITs.
const isReit = (f) => gicsSector(f?.sector) === "Real Estate" && (/\bREIT/i.test(f?.industry || "") || /Investment Trusts/i.test(f?.sector || ""));
export function pocf(f) {
  if (!isReit(f) || !(f?.marketCap > 0) || !(f?.operatingCashflow > 0)) return null;
  const x = f.marketCap / f.operatingCashflow;
  return x >= 2 && x <= 100 ? Math.round(x * 10) / 10 : null; // outside this, a currency or data mix-up
}
export const MIN_REITS = 5;
export function reitMedian(fs = []) {
  const xs = fs.map(pocf).filter((x) => x != null);
  return xs.length >= MIN_REITS ? { median: r1(median(xs)), n: xs.length } : null;
}
export function reitView(f, med) {
  const x = pocf(f);
  if (x == null) return null;
  const vs = med ? (Math.abs(x / med.median - 1) < 0.05 ? "in line with" : x < med.median ? `${Math.round((1 - x / med.median) * 100)}% below` : `${Math.round((x / med.median - 1) * 100)}% above`) : null;
  return { pocf: x, median: med?.median ?? null, n: med?.n ?? null,
    note: `Price / operating cash flow ${x}×, a rough stand-in for P/FFO${vs ? `, ${vs} the median of ${med.n} fully scored REITs (${med.median}×)` : ""}.` };
}
