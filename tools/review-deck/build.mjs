// Builds the weekly review PDF deck from a JSON content file.
//   node tools/review-deck/build.mjs content.json out.pdf [--png dir]
// Slide types: title, summary (headline + KPI tiles), list, table, two, plan.
// Uses the pre-installed Playwright Chromium.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [, , src, out, flag, pngDir] = process.argv;
if (!src || !out) { console.error("usage: build.mjs content.json out.pdf [--png dir]"); process.exit(1); }
const c = JSON.parse(readFileSync(src, "utf8"));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const TONE = { good: "var(--buy)", warn: "var(--watch)", bad: "var(--sell)", neutral: "var(--ink)" };

const total = c.slides.length + 1;
const foot = (n) => `<div class="foot"><span>${esc(c.title)} · ${esc(c.period)}</span><span>${n} / ${total}</span></div>`;

const slide = (s, n) => {
  const head = `<div class="eyebrow">${esc(s.eyebrow || "")}</div><h2>${esc(s.title)}</h2>`;
  let body = "";
  if (s.type === "summary") {
    body = `<p class="lede">${md(s.headline)}</p><div class="kpis">${(s.kpis || []).map((k) => `<div class="kpi"><div class="kl">${esc(k.label)}</div><div class="kv" style="color:${TONE[k.tone] || TONE.neutral}">${esc(k.value)}</div><div class="kn">${md(k.note || "")}</div></div>`).join("")}</div>`;
  } else if (s.type === "list") {
    body = `<div class="list ${s.items.length > 4 ? "dense" : ""}">${s.items.map((i) => `<div class="li"><div class="lt">${i.tag ? `<span class="tag ${i.tone || ""}">${esc(i.tag)}</span>` : ""}${md(i.title)}</div>${i.detail ? `<div class="ld">${md(i.detail)}</div>` : ""}</div>`).join("")}</div>`;
  } else if (s.type === "table") {
    body = `<table><thead><tr>${s.columns.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((v) => `<td>${md(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  } else if (s.type === "two") {
    const col = (x) => `<div class="col"><h3>${esc(x.heading)}</h3><ul>${x.items.map((i) => `<li>${md(i)}</li>`).join("")}</ul></div>`;
    body = `<div class="two">${col(s.left)}${col(s.right)}</div>`;
  } else if (s.type === "plan") {
    body = `<ol class="plan">${s.items.map((i) => `<li><b>${esc(i.title)}</b>${i.detail ? `<span>${md(i.detail)}</span>` : ""}</li>`).join("")}</ol>`;
  }
  const note = s.note ? `<p class="note">${md(s.note)}</p>` : "";
  return `<section class="slide">${head}<div class="body">${body}</div>${note}${foot(n)}</section>`;
};

const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><style>
:root { --bg:#f7f5f1; --card:#fff; --ink:#1b1a17; --ink2:#3d3a34; --muted:#77716a; --line:#e6e1d8; --buy:#14855a; --buybg:#e5f4ec; --watch:#b86a12; --watchbg:#fbf0df; --sell:#b3332a; --sellbg:#f9e4e1; }
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font: 20px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); -webkit-print-color-adjust: exact; print-color-adjust: exact; font-variant-numeric: tabular-nums; }
.slide { width: 1280px; height: 720px; padding: 64px 80px 56px; position: relative; page-break-after: always; overflow: hidden; background: var(--bg); display: flex; flex-direction: column; }
.eyebrow { font-size: 14px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 700; min-height: 18px; }
h2 { font-size: 40px; letter-spacing: -.025em; margin: 10px 0 26px; line-height: 1.1; max-width: 1000px; }
.body { flex: 1; min-height: 0; }
.foot { position: absolute; left: 80px; right: 80px; bottom: 26px; display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 10px; }
.cover { justify-content: center; background: var(--ink); color: var(--bg); }
.cover .mark { width: 56px; height: 56px; border-radius: 14px; background: var(--bg); display: grid; place-items: center; margin-bottom: 36px; }
.cover h1 { font-size: 72px; letter-spacing: -.035em; margin: 0; line-height: 1; }
.cover .sub { font-size: 30px; margin-top: 14px; color: #c9c3b8; }
.cover .meta { margin-top: 56px; font-size: 18px; color: #a39d94; }
.cover .foot { border-color: #3d3a34; color: #a39d94; }
.lede { font-size: 27px; line-height: 1.4; margin: 0 0 34px; max-width: 1060px; color: var(--ink2); }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.kpi { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px 22px; }
.kl { font-size: 13px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); font-weight: 700; }
.kv { font-size: 44px; font-weight: 750; letter-spacing: -.03em; margin-top: 6px; line-height: 1.1; }
.kn { font-size: 15px; color: var(--muted); margin-top: 6px; line-height: 1.35; }
.list { display: grid; gap: 14px; }
.list.dense { grid-template-columns: 1fr 1fr; gap: 14px 22px; }
.li { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 15px 20px; }
.lt { font-weight: 650; font-size: 20px; display: flex; align-items: center; gap: 10px; }
.ld { font-size: 16px; color: var(--muted); margin-top: 5px; line-height: 1.4; }
.dense .lt { font-size: 18px; } .dense .ld { font-size: 14.5px; }
.tag { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 3px 9px; border-radius: 99px; background: #eceae5; color: var(--ink2); white-space: nowrap; }
.tag.good { background: var(--buybg); color: var(--buy); } .tag.warn { background: var(--watchbg); color: var(--watch); } .tag.bad { background: var(--sellbg); color: var(--sell); }
table { width: 100%; border-collapse: collapse; font-size: 18px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
th { text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); padding: 12px 18px; background: #fbfaf7; border-bottom: 1px solid var(--line); }
td { padding: 11px 18px; border-top: 1px solid #efebe4; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.col { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 22px 26px; }
.col h3 { margin: 0 0 10px; font-size: 15px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
.col ul { margin: 0; padding-left: 20px; } .col li { margin: 8px 0; font-size: 18px; }
.plan { margin: 0; padding: 0; list-style: none; counter-reset: p; display: grid; gap: 12px; }
.plan li { counter-increment: p; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 20px 14px 66px; position: relative; }
.plan li::before { content: counter(p); position: absolute; left: 20px; top: 13px; width: 30px; height: 30px; border-radius: 50%; background: var(--ink); color: var(--bg); display: grid; place-items: center; font-weight: 700; font-size: 15px; }
.plan b { display: block; font-size: 19px; } .plan span { display: block; font-size: 15.5px; color: var(--muted); margin-top: 3px; }
.note { font-size: 15px; color: var(--muted); margin: 16px 0 0; max-width: 1060px; }
</style></head><body>
<section class="slide cover"><div class="mark"><svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="#1b1a17" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 11l4-4 3 3 5-6"/></svg></div>
<h1>${esc(c.title)}</h1><div class="sub">${esc(c.subtitle)}</div><div class="meta">${esc(c.period)} · prepared ${esc(c.date)}</div>${foot(1).replace("foot", "foot")}</section>
${c.slides.map((s, i) => slide(s, i + 2)).join("\n")}
</body></html>`;

const htmlPath = out.replace(/\.pdf$/, ".html");
writeFileSync(htmlPath, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("file://" + path.resolve(htmlPath));
await page.pdf({ path: out, width: "1280px", height: "720px", printBackground: true });
if (flag === "--png" && pngDir) {
  mkdirSync(pngDir, { recursive: true });
  const n = await page.locator(".slide").count();
  for (let i = 0; i < n; i++) await page.locator(".slide").nth(i).screenshot({ path: path.join(pngDir, `slide-${String(i + 1).padStart(2, "0")}.png`) });
  // Overflow check: content must not spill past the footer.
  const over = await page.evaluate(() => [...document.querySelectorAll(".slide")].map((s, i) => { const b = s.querySelector(".body"), n = s.querySelector(".note"); const lim = s.getBoundingClientRect().bottom - 60; return [i + 1, Math.max(b ? b.getBoundingClientRect().bottom : 0, n ? n.getBoundingClientRect().bottom : 0, ...[...s.querySelectorAll(".body *")].map((e) => e.getBoundingClientRect().bottom)) > lim]; }).filter((x) => x[1]).map((x) => x[0]));
  console.log(over.length ? `OVERFLOW on slides: ${over.join(", ")}` : "No overflow.");
}
await browser.close();
console.log(`Wrote ${out}`);
