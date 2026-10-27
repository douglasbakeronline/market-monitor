import { writeFile } from "node:fs/promises";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const out = {};
async function t(name, fn) { try { out[name] = await fn(); } catch (e) { out[name] = { error: String(e) }; } }
async function get(url, opts = {}) { const r = await fetch(url, { headers: { "user-agent": UA, ...(opts.headers||{}) } }); const txt = await r.text(); return { status: r.status, len: txt.length, head: txt.slice(0, 300), txt, res: r }; }
for (const host of ["query1", "query2"]) for (const s of ["^GSPC", "^VIX", "AZN.L", "SPCX", "^FTSE", "^STOXX50E", "^N225", "^HSI"]) {
  await t(`yahoo_chart_${host}_${s}`, async () => { const r = await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=2y&interval=1d`); let info = {}; try { const j = JSON.parse(r.txt).chart.result[0]; info = { n: j.timestamp.length, first: new Date(j.timestamp[0]*1000), last: new Date(j.timestamp.at(-1)*1000), lastClose: j.indicators.quote[0].close.at(-1), meta: { cur: j.meta.currency, price: j.meta.regularMarketPrice, tz: j.meta.exchangeTimezoneName } }; } catch {} return { status: r.status, len: r.len, info }; });
}
await t("yahoo_chart_max_gspc", async () => { const r = await get(`https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=max&interval=1d`); const j = JSON.parse(r.txt).chart.result[0]; return { status: r.status, n: j.timestamp.length, first: new Date(j.timestamp[0]*1000) }; });
await t("yahoo_crumb", async () => {
  const c = await fetch("https://fc.yahoo.com", { headers: { "user-agent": UA }, redirect: "manual" });
  const cookies = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "user-agent": UA, cookie: cookies } });
  const crumb = await cr.text();
  const res = {};
  for (const s of ["MSFT", "AZN.L", "SPCX"]) {
    const q = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile&crumb=${encodeURIComponent(crumb)}`, { headers: { "user-agent": UA, cookie: cookies } });
    const txt = await q.text(); res[s] = { status: q.status, len: txt.length };
    if (s === "MSFT") res.sample = txt.slice(0, 6000);
  }
  return { cookieStatus: c.status, hasCookie: !!cookies, crumbStatus: cr.status, crumb: crumb.slice(0, 20), res };
});
await t("stooq", async () => { const r = await get("https://stooq.com/q/d/l/?s=%5Espx&i=d"); return { status: r.status, head: r.head }; });
await t("cnn_default", async () => { const r = await get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", { headers: { accept: "application/json" } }); const j = JSON.parse(r.txt); const h = j.fear_and_greed_historical.data; return { status: r.status, n: h.length, first: new Date(h[0].x), keys: Object.keys(j), fg: j.fear_and_greed }; });
for (const d of ["2011-01-01", "2018-01-01", "2020-07-15", "2021-01-01"]) await t(`cnn_${d}`, async () => { const r = await get(`https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${d}`, { headers: { accept: "application/json" } }); let info = {}; try { const h = JSON.parse(r.txt).fear_and_greed_historical.data; info = { n: h.length, first: new Date(h[0].x), last: new Date(h.at(-1).x) }; } catch {} return { status: r.status, len: r.len, info }; });
await t("ntfy_reach", async () => { const r = await get("https://ntfy.sh/v1/health"); return { status: r.status, head: r.head }; });
await writeFile("probe/results.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
