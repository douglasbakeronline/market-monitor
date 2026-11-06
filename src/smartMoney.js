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
