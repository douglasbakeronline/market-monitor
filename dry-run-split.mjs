import { fetchDaily } from "./src/data/prices.js";
for (const s of ["KLAC", "NVDA", "AVGO", "WMT", "CMG"]) {
  try {
    const d = await fetchDaily(s, { range: "2y" });
    const r = d.rows;
    const hi = r.slice(-252).reduce((a, b) => (b.close > a.close ? b : a));
    console.log(s, "splits", JSON.stringify(d.splits), "last", r.at(-1).date, r.at(-1).close.toFixed(2), "high", hi.date, hi.close.toFixed(2), "y1ago", r.at(-253)?.close.toFixed(2));
    for (const sp of d.splits) { const k = r.findIndex((x) => x.date >= sp.date); console.log("  around", r.slice(Math.max(0, k - 2), k + 2).map((x) => `${x.date} ${x.close.toFixed(2)}`).join(" | ")); }
  } catch (e) { console.log(s, "error", e.message); }
}
