// Spot checks of the Buffett lens (15 Nov 2026): the raw annual accounts Yahoo
// gives for a few symbols, with currency and extra EPS lines, to compare with
// the companies' reports. Run on the runners (Yahoo is blocked from the sandbox):
//   node tools/buffett-inputs.mjs ULVR.L,KO > out.json
import { fetchTimeseries } from "../src/data/fundamentals.js";
import { parseTimeseries, TS_TYPES } from "../src/buffett.js";
const syms = (process.argv[2] ?? "ULVR.L,DGE.L,III.L,KO,ADBE,AAPL,CB").split(",");
const out = {};
for (const s of syms) {
  try {
    const raw = await fetchTimeseries(s, [...TS_TYPES, "BasicEPS", "NetIncomeContinuousOperations", "NetIncomeDiscontinuousOperations", "NetIncomeCommonStockholders"]);
    const cur = (raw?.timeseries?.result ?? []).map((r) => r?.[r?.meta?.type?.[0]]?.find?.(Boolean)?.currencyCode).find(Boolean);
    out[s] = { currency: cur, ...parseTimeseries(raw), extra: Object.fromEntries((raw?.timeseries?.result ?? []).filter((r) => /EPS|Operations|Common/.test(r?.meta?.type?.[0])).map((r) => [r.meta.type[0], (r[r.meta.type[0]] ?? []).filter(Boolean).map((x) => [x.asOfDate, x.reportedValue?.raw, x.currencyCode])])) };
  } catch (e) { out[s] = { error: e.message }; }
}
console.log(JSON.stringify(out, null, 1));
