// Which scan items get full fundamentals in stage 2 (the "deep" score).
// The best long-term candidates, the top swing setups, every Real Estate name
// (the REIT cash-flow median needs them) and, since 13 Nov, the focus names:
// the research list, the picks and the bench. Without the focus names, the
// scan showed a quick score for a list stock that the Research list scored in
// full, up to 22 points apart (AMD 37 vs 59, Meta 65 vs 77; review 13 Nov).
import { isRealEstate } from "./sectorValue.js";

export function deepenList(items, { long, swing, focus = new Set() }) {
  const byLong = items.filter((i) => i.lt?.score != null).sort((a, b) => b.lt.score - a.lt.score).slice(0, long);
  const bySwing = items.filter((i) => i.swing?.verdict?.startsWith("Setup")).sort((a, b) => b.swing.score - a.swing.score).slice(0, swing);
  const byReit = items.filter((i) => isRealEstate(i.f, i.u.sector));
  const byFocus = items.filter((i) => focus.has(i.u.symbol));
  return [...new Set([...byLong, ...bySwing, ...byReit, ...byFocus])];
}
