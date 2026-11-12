// Probe (12 Nov): free sources of PAST results dates, for the results preview's
// usual move. Prints what each source returns for a few names.
import { yahooSession } from "../src/data/fundamentals.js";
import { UA } from "../src/data/http.js";

const syms = ["NVDA", "KO", "HSBA.L", "BRBY.L"];
const get = async (url, headers = {}) => {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json, text/plain, */*", ...headers }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    return { status: r.status, body: t.slice(0, 1500) };
  } catch (e) { return { error: e.message }; }
};
const { cookie, crumb } = await yahooSession();
const out = {};
for (const s of syms) {
  out[s] = {
    earningsModule: await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=earnings,secFilings&crumb=${encodeURIComponent(crumb)}`, { cookie }),
    chartEarn: await get(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=2y&interval=1d&events=earn`, { cookie }),
    visualization: await get(`https://query2.finance.yahoo.com/v1/finance/visualization?crumb=${encodeURIComponent(crumb)}`, { cookie, "content-type": "application/json" }),
    nasdaq: s.includes(".") ? null : await get(`https://api.nasdaq.com/api/company/${s}/earnings-surprise`, { origin: "https://www.nasdaq.com", referer: "https://www.nasdaq.com/" }),
  };
}
// The visualization endpoint needs a POST body.
const vz = async (s) => {
  try {
    const body = { offset: 0, size: 25, sortField: "startdatetime", sortType: "DESC", entityIdType: "earnings", includeFields: ["ticker", "startdatetime", "startdatetimetype", "epsestimate", "epsactual"], query: { operator: "eq", operands: ["ticker", s] } };
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/visualization?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`, { method: "POST", headers: { "user-agent": UA, cookie, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    return { status: r.status, body: (await r.text()).slice(0, 2500) };
  } catch (e) { return { error: e.message }; }
};
for (const s of syms) out[s].visualization = await vz(s);
console.log(JSON.stringify(out, null, 1));
