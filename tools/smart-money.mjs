// Smart money, step 1: fetch the latest two 13F-HR filings of each manager in
// src/smartMoney.js from SEC EDGAR, map CUSIPs to tickers with OpenFIGI
// (cached in data/cusip-map.json), and write data/smart-money.json.
// Without the SEC_CONTACT secret (or when EDGAR refuses) it uses 13f.info,
// which republishes the same filings with tickers (8 Nov).
//   node tools/smart-money.mjs [outFile]
import { readFile, writeFile } from "node:fs/promises";
import { MANAGERS, parseInfoTable, aggregate, diff, figiTicker, byTicker, parse13fInfoFilings, parse13fInfoData } from "../src/smartMoney.js";
import { sleep } from "../src/util.js";

// SEC asks automated clients for a name and contact address in the User-Agent
// and returns 403 without one. The address comes from the SEC_CONTACT repo
// secret so it never appears in this public repo.
const CONTACT = process.env.SEC_CONTACT || "market-monitor-bot@users.noreply.github.com";
const UA = { "User-Agent": `MarketMonitor ${CONTACT}`, Accept: "application/json, text/xml, */*" };
const out = process.argv[2] || "data/smart-money.json";
const MAP = "data/cusip-map.json";

async function get(url, as = "json") {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return as === "json" ? r.json() : r.text();
    await sleep(1500 * (t + 1));
    if (t === 2) throw new Error(`${r.status} ${url} ${(await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160)}`);
  }
}

async function filing(cik, acc) {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}`;
  const idx = await get(`${base}/index.json`);
  const xmls = (idx?.directory?.item || []).map((i) => i.name).filter((n) => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  for (const n of xmls) {
    await sleep(150);
    const rows = parseInfoTable(await get(`${base}/${n}`, "text"));
    if (rows.length) return aggregate(rows);
  }
  throw new Error(`no information table in ${acc}`);
}

const managers = [], problems = [];
let map = {};
try { map = JSON.parse(await readFile(MAP, "utf8")); } catch { /* first run */ }

// 13f.info: manager page (filings list) and one JSON per filing.
const UA2 = { "User-Agent": "market-monitor research (github.com/douglasbakeronline/market-monitor)" };
async function get2(url, as = "json") {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(url, { headers: UA2, redirect: "follow" });
    if (r.ok) return as === "json" ? r.json() : r.text();
    if (r.status === 404) throw new Error(`404 ${url}`);
    await sleep(2000 * (t + 1));
    if (t === 2) throw new Error(`${r.status} ${url}`);
  }
}
async function from13fInfo(m) {
  const html = await get2(`https://13f.info/manager/${m.cik}`, "text");
  const title = ((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || "").trim()
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
  if (!m.expect.test(title)) throw new Error(`13f.info page for CIK ${m.cik} is "${title.slice(0, 60)}"`);
  const filings = parse13fInfoFilings(html).slice(0, 2);
  if (!filings.length) throw new Error("no 13F-HR filings on 13f.info");
  const load = async (f) => { await sleep(800); const { rows, tickers } = parse13fInfoData(await get2(`https://13f.info/data/13f/${f.acc}`)); Object.assign(map, Object.fromEntries(Object.entries(tickers).filter(([c]) => !map[c]))); return aggregate(rows); };
  const cur = await load(filings[0]);
  const prev = filings[1] ? await load(filings[1]).catch(() => null) : null;
  const { holdings, sold } = diff(cur, prev);
  return { key: m.key, name: m.name, filer: title, period: filings[0].period, filed: filings[0].filed,
    prevPeriod: filings[1]?.period ?? null, positions: holdings.length, holdings, sold, source: "13f.info" };
}

const useSec = !!process.env.SEC_CONTACT;
for (const m of MANAGERS) {
  if (!useSec) {
    try { managers.push(await from13fInfo(m)); } catch (e) { problems.push(`${m.name}: ${e.message}`); }
    await sleep(800);
    continue;
  }
  try {
    const sub = await get(`https://data.sec.gov/submissions/CIK${m.cik}.json`);
    if (!m.expect.test(sub.name || "")) { problems.push(`${m.name}: CIK ${m.cik} is "${sub.name}"`); continue; }
    const r = sub.filings.recent;
    const idx = r.form.map((f, i) => (f === "13F-HR" ? i : -1)).filter((i) => i >= 0).slice(0, 2);
    if (!idx.length) { problems.push(`${m.name}: no 13F-HR filings`); continue; }
    const cur = await filing(m.cik, r.accessionNumber[idx[0]]);
    const prev = idx[1] != null ? await filing(m.cik, r.accessionNumber[idx[1]]).catch(() => null) : null;
    const { holdings, sold } = diff(cur, prev);
    managers.push({ key: m.key, name: m.name, filer: sub.name, period: r.reportDate[idx[0]], filed: r.filingDate[idx[0]],
      prevPeriod: idx[1] != null ? r.reportDate[idx[1]] : null, positions: holdings.length, holdings, sold, source: "SEC EDGAR" });
  } catch (e) {
    problems.push(`${m.name}: SEC ${e.message.slice(0, 80)}; trying 13f.info`);
    try { managers.push(await from13fInfo(m)); } catch (e2) { problems.push(`${m.name}: ${e2.message}`); }
  }
  await sleep(300);
}

// CUSIP -> ticker via OpenFIGI (no key: 25 requests a minute, 10 jobs each)
// for anything 13f.info did not already map.
const need = [...new Set(managers.flatMap((m) => [...m.holdings, ...m.sold].map((h) => h.cusip)))].filter((c) => !(c in map));
for (let i = 0; i < need.length; i += 10) {
  const chunk = need.slice(i, i + 10);
  try {
    const r = await fetch("https://api.openfigi.com/v3/mapping", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk.map((c) => ({ idType: "ID_CUSIP", idValue: c }))) });
    if (r.status === 429) { await sleep(60000); i -= 10; continue; }
    const res = await r.json();
    chunk.forEach((c, k) => { map[c] = figiTicker(res[k]); });
  } catch (e) { problems.push(`OpenFIGI: ${e.message}`); break; }
  await sleep(2600);
}
await writeFile(MAP, JSON.stringify(map, null, 0) + "\n");

const tickers = byTicker(managers, map);
const mapped = managers.reduce((a, m) => a + m.holdings.filter((h) => map[h.cusip]).length, 0);
const total = managers.reduce((a, m) => a + m.holdings.length, 0);
await writeFile(out, JSON.stringify({ updated: new Date().toISOString(), source: [...new Set(managers.map((m) => m.source))].join(" and ") + " 13F-HR; tickers via 13f.info and OpenFIGI",
  mapped, total, problems, managers, byTicker: tickers }, null, 0) + "\n");
console.log(JSON.stringify({ mapped, total, problems, managers: managers.map((m) => ({ name: m.name, filer: m.filer, period: m.period, filed: m.filed,
  positions: m.positions, sold: m.sold.length, top: m.holdings.slice(0, 5).map((h) => `${map[h.cusip] || h.name} ${h.weight}% ${h.change}`) })) }, null, 1));
