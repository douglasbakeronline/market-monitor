// Probe (17 Nov): why is Pershing Square stuck at its Q1 2026 13F on 13f.info?
import { parse13fInfoFilings } from "../src/smartMoney.js";
const UA = { "User-Agent": "market-monitor research (github.com/douglasbakeronline/market-monitor)" };
for (const cik of ["0001336528", "0001067983"]) {
  const r = await fetch(`https://13f.info/manager/${cik}`, { headers: UA, redirect: "follow" });
  const html = await r.text();
  console.log("==", cik, r.status, r.url, html.length);
  console.log("parsed:", JSON.stringify(parse13fInfoFilings(html).slice(0, 5)));
  const rows = html.split(/<tr[\s>]/i).slice(1, 7);
  rows.forEach((x, i) => console.log(`row ${i}:`, x.replace(/\s+/g, " ").slice(0, 700)));
}
// EDGAR's own submissions list (may 403 without a contact UA)
const s = await fetch("https://data.sec.gov/submissions/CIK0001336528.json", { headers: UA });
console.log("SEC", s.status);
if (s.ok) { const j = await s.json(); const f = j.filings.recent; for (let i = 0; i < 40; i++) if (/13F/.test(f.form[i])) console.log(f.form[i], f.reportDate[i], f.filingDate[i], f.accessionNumber[i]); }
