// Spot checks of the Buffett lens (15 Nov 2026): the raw annual accounts Yahoo
// gives for a few symbols, with currency and extra EPS lines, and the lens's
// quality result on them, to compare with the companies' reports. Run on the
// runners (Yahoo is blocked from the sandbox):
//   node tools/buffett-inputs.mjs ULVR.L,KO > out.json
import { readFileSync } from "node:fs";
import { fetchTimeseries } from "../src/data/fundamentals.js";
import { parseTimeseries, buffettQuality, TS_TYPES } from "../src/buffett.js";

const syms = (process.argv[2] ?? "ULVR.L,KO").split(",");
let scan = [];
try { scan = JSON.parse(readFileSync("scan.json", "utf8")).items ?? []; } catch { /* no scan */ }
const out = {};
for (const s of syms) {
  try {
    const raw = await fetchTimeseries(s, [...TS_TYPES, "BasicEPS", "NetIncomeContinuousOperations", "NetIncomeCommonStockholders"]);
    const res = raw?.timeseries?.result ?? [];
    const cur = res.map((r) => r?.[r?.meta?.type?.[0]]?.find?.(Boolean)?.currencyCode).find(Boolean);
    const it = scan.find((x) => x.symbol === s), parsed = parseTimeseries(raw);
    out[s] = { currency: cur, sector: it?.sector ?? null, ...parsed,
      quality: buffettQuality(parsed, { sector: it?.sector, industry: it?.industry }),
      extra: Object.fromEntries(res.filter((r) => /EPS|Operations|Common/.test(r?.meta?.type?.[0])).map((r) => [r.meta.type[0], (r[r.meta.type[0]] ?? []).filter(Boolean).map((x) => [x.asOfDate, x.reportedValue?.raw])])) };
  } catch (e) { out[s] = { error: e.message }; }
}
console.log(JSON.stringify(out, null, 1));
