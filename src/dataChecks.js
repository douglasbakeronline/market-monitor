// Automatic data checks on the nightly index scan. The daily spot checks found
// real bugs by hand (UK yields 100x too small, "-1 days" results dates,
// unadjusted splits, a delisted stock's frozen price); these rules look for
// the same kinds of fault in every item, every night, so a bad number is
// flagged before anyone acts on it. Display only: nothing is rescored.

const DAY = 86400000;

// Each check: key, a short label, and a test returning a detail string or null.
export const CHECKS = [
  { key: "stalePrice", label: "Price not updated", test: (it, ctx) => {
    if (!it.date || !ctx.asOf) return null;
    const d = Math.round((Date.parse(ctx.asOf) - Date.parse(it.date)) / DAY);
    return d > 5 ? `last price ${it.date}, ${d} days before the scan` : null;
  } },
  { key: "outsideRange", label: "Price outside its 52-week range", test: (it) => {
    const p = it.price, hi = it.tech?.high52, lo = it.tech?.low52;
    if (!(p > 0) || !(hi > 0) || !(lo > 0)) return null;
    if (p > hi * 1.02) return `price ${p} above the 52-week high ${hi}`;
    if (p < lo * 0.98) return `price ${p} below the 52-week low ${lo}`;
    return null;
  } },
  { key: "offHigh", label: "Off-high does not match price and high", test: (it) => {
    const p = it.price, hi = it.tech?.high52, oh = it.tech?.offHigh;
    if (!(p > 0) || !(hi > 0) || !Number.isFinite(oh)) return null;
    const calc = (p / hi - 1) * 100;
    return Math.abs(calc - oh) > 3 ? `shows ${oh}%, price and high give ${calc.toFixed(1)}%` : null;
  } },
  { key: "bigDay", label: "One-day move over 35%", test: (it) => {
    const d = it.perf?.day;
    return Number.isFinite(d) && Math.abs(d) > 35 ? `${d > 0 ? "+" : ""}${d}% today (a split, a bad tick or real news)` : null;
  } },
  { key: "yield", label: "Dividend yield looks wrong", test: (it) => {
    const y = it.dividendYield;
    if (!Number.isFinite(y) || y <= 0) return null;
    if (y > 0.15) return `${(y * 100).toFixed(1)}% (over 15%: often a special dividend or a unit error)`;
    if (y < 0.0005 && it.market === "UK") return `${(y * 100).toFixed(3)}% (tiny for a UK payer: the old 100x unit fault?)`;
    return null;
  } },
  { key: "pe", label: "P/E out of range", test: (it) => {
    const pe = it.pe;
    // Trusts and holding companies are not scored; their P/E means little.
    if (!Number.isFinite(pe) || it.longTerm?.score == null) return null;
    if (pe <= 0) return `P/E ${pe} (zero or negative should show as none)`;
    if (pe < 2) return `P/E ${pe} (under 2: check for a one-off gain or a currency mix-up)`;
    return null;
  } },
  { key: "target", label: "Analyst target far from price", test: (it) => {
    const t = it.target?.mean, p = it.price;
    if (!(t > 0) || !(p > 0) || !((it.target?.analysts ?? 0) >= 3)) return null;
    const r = t / p;
    return r > 3 || r < 0.33 ? `target ${t} vs price ${p} (${r.toFixed(2)}x: pence and pounds mixed?)` : null;
  } },
  { key: "pastResults", label: "Next results date in the past", test: (it) => {
    const d = it.earnings?.days;
    return Number.isFinite(d) && d < 0 ? `${it.earnings.date} (${d} days)` : null;
  } },
];

// Run every check on every item. ctx.asOf: the scan's date (YYYY-MM-DD).
// Returns { checked, flagged, byCheck: {key: n}, flags: [{symbol, name, key, label, detail}] }.
export function runDataChecks(items = [], ctx = {}) {
  const flags = [], byCheck = {};
  let checked = 0;
  for (const it of items || []) {
    if (!it?.symbol || it.extra) continue;
    checked++;
    for (const c of CHECKS) {
      let detail = null;
      try { detail = c.test(it, ctx); } catch { detail = null; }
      if (!detail) continue;
      flags.push({ symbol: it.symbol, ticker: it.ticker ?? it.symbol, name: it.name ?? it.symbol, key: c.key, label: c.label, detail, ...(it.list ? { list: true } : {}) });
      byCheck[c.key] = (byCheck[c.key] || 0) + 1;
    }
  }
  const flagged = new Set(flags.map((f) => f.symbol)).size;
  return { asOf: ctx.asOf ?? null, checked, flagged, byCheck, flags: flags.slice(0, 60), more: Math.max(0, flags.length - 60) };
}

// One line for logs and the page.
export function dataChecksLine(dc) {
  if (!dc?.checked) return null;
  if (!dc.flagged) return `Data checks: all ${dc.checked} items passed.`;
  const top = Object.entries(dc.byCheck).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${CHECKS.find((c) => c.key === k)?.label.toLowerCase() ?? k} ${n}`).join(", ");
  return `Data checks: ${dc.flagged} of ${dc.checked} items flagged (${top}).`;
}

// Sunday digest line: silent when everything passed; names any pick or
// Research-list stock flagged first, as those are the ones acted on.
export function checksDigestLine(dc, picks = []) {
  if (!dc?.flagged) return null;
  const ps = new Set(picks);
  const mine = dc.flags.filter((f) => ps.has(f.symbol) || f.list);
  const base = dataChecksLine(dc);
  if (!mine.length) return `${base} None is a pick or on your list.`;
  return `${base} Check before acting: ${[...new Map(mine.map((f) => [f.symbol, `${f.ticker} (${f.label.toLowerCase()})`])).values()].join(", ")}.`;
}
