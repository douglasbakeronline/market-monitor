// Smart-money signal, step 1: 13F holdings of a few long-term managers.
// Pure functions only; tools/smart-money.mjs does the fetching (SEC EDGAR for
// the filings, OpenFIGI to map CUSIPs to tickers). Tracked as a tie-breaker
// tag, never a buy rule (research log 30 Oct: evidence is weak, 13F data is
// up to 45 days late after each quarter end).

// Long-term, low-turnover managers. CIKs are checked against the filer name
// returned by EDGAR at fetch time (tools/smart-money.mjs), so a wrong one is
// reported, not silently used.
export const MANAGERS = [
  { key: "berkshire", name: "Berkshire Hathaway", cik: "0001067983", expect: /BERKSHIRE/i },
  { key: "fundsmith", name: "Fundsmith", cik: "0001569205", expect: /FUNDSMITH/i },
  { key: "akre", name: "Akre Capital", cik: "0001112520", expect: /AKRE/i },
  { key: "pershing", name: "Pershing Square", cik: "0001336528", expect: /PERSHING/i },
  { key: "dodgecox", name: "Dodge & Cox", cik: "0000200217", expect: /DODGE/i },
];

const tag = (block, name) => {
  const m = block.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i"));
  return m ? m[1].trim() : null;
};

// 13F information table XML -> [{name, cusip, value, shares}] (options excluded).
export function parseInfoTable(xml) {
  const out = [];
  const re = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    if (tag(b, "putCall")) continue;
    const cusip = (tag(b, "cusip") || "").toUpperCase();
    const shares = Number(tag(b, "sshPrnamt"));
    const value = Number(tag(b, "value"));
    if (!cusip || !Number.isFinite(value)) continue;
    out.push({ name: tag(b, "nameOfIssuer") || "", cusip, value, shares: Number.isFinite(shares) ? shares : 0 });
  }
  return out;
}

// Merge rows for the same CUSIP (managers split a holding across sub-advisers)
// and add portfolio weights in %.
export function aggregate(rows) {
  const by = new Map();
  for (const r of rows) {
    const x = by.get(r.cusip) || { name: r.name, cusip: r.cusip, value: 0, shares: 0 };
    x.value += r.value; x.shares += r.shares;
    by.set(r.cusip, x);
  }
  const list = [...by.values()];
  const total = list.reduce((a, b) => a + b.value, 0) || 1;
  return list.map((x) => ({ ...x, weight: Math.round((x.value / total) * 1000) / 10 }))
    .sort((a, b) => b.value - a.value);
}

// Quarter-on-quarter change by share count: new, added (+10%+), trimmed
// (-10%+), held, and the list of positions sold out.
export function diff(cur, prev) {
  const p = new Map((prev || []).map((x) => [x.cusip, x]));
  const holdings = cur.map((x) => {
    const o = p.get(x.cusip);
    if (!prev) return { ...x, change: "held", sharesChangePct: null };
    if (!o) return { ...x, change: "new", sharesChangePct: null };
    const chg = o.shares ? Math.round(((x.shares - o.shares) / o.shares) * 1000) / 10 : null;
    const change = chg == null ? "held" : chg >= 10 ? "added" : chg <= -10 ? "trimmed" : "held";
    return { ...x, change, sharesChangePct: chg };
  });
  const now = new Set(cur.map((x) => x.cusip));
  const sold = (prev || []).filter((x) => !now.has(x.cusip)).map((x) => ({ name: x.name, cusip: x.cusip }));
  return { holdings, sold };
}

// Pick a US common-stock ticker from an OpenFIGI mapping result.
export function figiTicker(result) {
  const data = result?.data || [];
  const pick = data.find((d) => d.exchCode === "US" && /Common Stock|ADR|REIT/i.test(d.securityType || ""))
    || data.find((d) => d.exchCode === "US") || data[0];
  return pick?.ticker ? pick.ticker.replace("/", ".") : null;
}

// Yahoo uses "-" for share classes (BRK-B); OpenFIGI uses "/" or ".".
export const toYahoo = (t) => (t ? t.replace(/[./]/g, "-") : t);

// Ticker -> [{manager, weight, change}] for tags on the scan and Research pages.
export function byTicker(managers, cusipMap) {
  const out = {};
  for (const m of managers) {
    for (const h of m.holdings || []) {
      const t = toYahoo(cusipMap[h.cusip]);
      if (!t) continue;
      (out[t] ||= []).push({ manager: m.name, weight: h.weight, change: h.change });
    }
    for (const s of m.sold || []) {
      const t = toYahoo(cusipMap[s.cusip]);
      if (t) (out[t] ||= []).push({ manager: m.name, weight: 0, change: "sold" });
    }
  }
  return out;
}

// One short tag for a ticker, e.g. "Held by Berkshire Hathaway (new), Akre Capital".
export function smartTag(entries) {
  const held = (entries || []).filter((e) => e.change !== "sold");
  if (!held.length) return null;
  const names = held.sort((a, b) => b.weight - a.weight)
    .map((e) => e.change === "new" || e.change === "added" ? `${e.manager} (${e.change})` : e.manager);
  return `Held by ${names.join(", ")}`;
}

// --- Fallback source: 13f.info (8 Nov) -----------------------------------------
// SEC EDGAR blocks GitHub's runners unless the User-Agent carries a real contact
// (the SEC_CONTACT secret). 13f.info republishes the same 13F filings, already
// mapped to tickers, and its robots.txt allows these pages. Two requests per
// filing: the manager page (list of filings) and the holdings JSON.

// Manager page HTML -> [{acc, period, filed, form}] newest period first.
// Only original 13F-HR filings are kept (amendments and notices are skipped).
export function parse13fInfoFilings(html) {
  const out = [];
  const rows = String(html || "").split(/<tr[\s>]/i).slice(1);
  for (const r of rows) {
    const link = /href="\/13f\/(\d{18})-[^"]*"/.exec(r);
    if (!link) continue;
    const dates = [...r.matchAll(/data-order="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
    const form = (/title="(13F-[^"]*)"/.exec(r) || [])[1] || null;
    if (form !== "13F-HR" || dates.length < 2) continue;
    out.push({ acc: link[1], period: dates[0], filed: dates[1], form });
  }
  // One filing per period (the first listed), newest first.
  const seen = new Set();
  return out.sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0))
    .filter((f) => !seen.has(f.period) && seen.add(f.period));
}

// Holdings JSON ({data: [[ticker, name, class, cusip, value, pct, shares, x, putCall]]})
// -> rows for aggregate(), plus a CUSIP -> ticker map. Options are excluded.
export function parse13fInfoData(json) {
  const rows = [], tickers = {};
  for (const r of json?.data || []) {
    if (!Array.isArray(r) || r.length < 7) continue;
    if (/put|call/i.test(String(r[8] ?? "")) || /put|call/i.test(String(r[7] ?? ""))) continue;
    const cusip = String(r[3] || "").toUpperCase();
    const value = Number(r[4]);
    if (!cusip || !Number.isFinite(value)) continue;
    const shares = Number(r[6]);
    rows.push({ name: r[1] || "", cusip, value, shares: Number.isFinite(shares) ? shares : 0 });
    if (r[0] && !(cusip in tickers)) tickers[cusip] = String(r[0]);
  }
  return { rows, tickers };
}

// --- Step 2: tags on scan and Research items (display only, 8 Nov) -------------
export const quarterLabel = (period) => (period ? `Q${Math.ceil(Number(period.slice(5, 7)) / 3)} ${period.slice(0, 4)}` : null);

// What the tracked managers did with one stock, from data/smart-money.json.
// Only positions of at least MIN_WEIGHT % of a manager's portfolio count, so a
// broad book (Dodge & Cox holds 200+ names) does not tag half the market.
// Returns null when no tracked manager holds it that size or sold out of it.
export const MIN_WEIGHT = 1;
// Backtest 8 Nov (research log, tools/smart-backtest.mjs): five years of these
// managers' new or added positions did not beat the market after filing.
export const TESTED = "Tested since 2022: their new or added positions did not beat the market once filed.";
export function smartFor(symbol, sm) {
  const all = sm?.byTicker?.[symbol];
  if (!all?.length) return null;
  const entries = all.filter((e) => e.change === "sold" || e.weight >= MIN_WEIGHT);
  const tag = smartTag(entries);
  const sold = entries.filter((e) => e.change === "sold").map((e) => e.manager);
  if (!tag && !sold.length) return null;
  const periods = [...new Set((sm.managers || []).filter((m) => entries.some((e) => e.manager === m.name)).map((m) => m.period).filter(Boolean))].sort();
  const asOf = periods.length > 1 ? `${quarterLabel(periods[0])} to ${quarterLabel(periods.at(-1))}` : quarterLabel(periods[0]);
  const parts = [tag, sold.length ? `Sold out by ${sold.join(", ")}` : null].filter(Boolean);
  const note = `${parts.join(". ")}. From ${asOf ? `${asOf} ` : ""}13F filings (positions of ${MIN_WEIGHT}% or more), published up to 45 days after each quarter. ${TESTED}`;
  return { tag, sold, asOf, managers: entries.filter((e) => e.change !== "sold").length, note };
}

// Track-record event when a stock gains a new or added position by a tracked
// manager (a fresh quarter of filings). prevKey is what the last run saw;
// undefined means this stock has no smart-money memory yet, so it is recorded
// silently (no burst of events for old filings when this first runs).
export function smartEvent(prevKey, sm) {
  const key = sm ? `${sm.asOf ?? ""}|${sm.tag ?? ""}` : null;
  const fire = prevKey !== undefined && key !== prevKey && /\((new|added)\)/.test(sm?.tag || "");
  return { key, fire, label: fire ? `Smart money: ${sm.tag.replace(/^Held by /, "")}` : null };
}
