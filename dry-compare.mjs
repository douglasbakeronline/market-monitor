// Dry run only (13 Nov): the scan's score vs the Research list's for each list name.
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync("dry-run/scan.json")), r = JSON.parse(readFileSync("dry-run/research.json"));
const by = Object.fromEntries(s.items.map((i) => [i.symbol, i]));
console.log(`scan deepened ${s.deepened} of ${s.scored}; research ${r.count} scored, placeholder ${r.placeholder}, failed ${r.failed.join(" ") || "none"}`);
let same = 0, quick = 0;
for (const i of r.items) {
  const x = by[i.symbol];
  if (x && !x.deep) quick++;
  if (x && x.longTerm?.score === i.longTerm?.score) same++;
  console.log([i.symbol, i.longTerm?.score, i.longTerm?.verdict, "| scan", x?.longTerm?.score ?? "-", x?.longTerm?.verdict ?? "not in scan", x ? (x.deep ? "deep" : "QUICK") : ""].join(" "));
}
console.log(`same score: ${same} of ${r.items.length}; still quick on the scan: ${quick}`);
