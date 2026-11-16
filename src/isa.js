// ISA tracker for the Dashboard (browser only): how much of this tax year's
// allowance the deposits have used, and the dividends and interest received,
// from cash movements in a Trading 212 export (tradeLog.js parseT212()).
// Deposits are treated as subscriptions; a transfer in from another ISA does
// not use the allowance, so the page says to check those.

export const ISA = {
  allowance: 20000, // overall annual limit, 2026/27 and (as announced) 2027/28
  // Proposed at Autumn Budget 2025 for 6 Apr 2027: a 22% charge on interest
  // earned on cash held in a stocks and shares ISA. Dropped at Autumn Budget
  // 2026 with the cash ISA cut and its anti-circumvention rules (HMRC tax-free
  // savings newsletter 24, 29 Oct 2026; research log 16 Nov 2026).
  cashInterestCharge: { from: "2027-04-06", rate: 22, status: "dropped", dropped: "2026-10-28" },
};

// The Dashboard's line on the cash-interest charge, by its status.
export function cashChargeNote(c) {
  if (!c) return "";
  if (c.status === "dropped") return "The charge proposed on interest from cash held in a stocks and shares ISA from April 2027 will not go ahead (Autumn Budget 2026), so interest on your dip reserve stays tax-free.";
  return `Proposed from 6 April 2027 (draft rules, not yet law as far as we know): interest on cash held in a stocks and shares ISA would face a ${c.rate}% charge. Your dip reserve is cash in the ISA, so this is on the roadmap for a decision before then.`;
}

// UK tax year label for a date: 6 April to 5 April, e.g. "2026/27".
export function taxYearOf(ymd) {
  const y = +ymd.slice(0, 4), md = ymd.slice(5);
  const start = md >= "04-06" ? y : y - 1;
  return { label: `${start}/${String((start + 1) % 100).padStart(2, "0")}`, start: `${start}-04-06`, end: `${start + 1}-04-05`, next: `${start + 1}-04-06` };
}

export function isaSummary(events = [], today, allowance = ISA.allowance) {
  const ty = taxYearOf(today);
  const inYear = events.filter((e) => e?.date >= ty.start && e.date <= ty.end);
  const sum = (k) => Math.round(inYear.filter((e) => e.kind === k).reduce((a, e) => a + (e.amount || 0), 0) * 100) / 100;
  const deposits = sum("deposit"), withdrawals = sum("withdrawal"), dividends = sum("dividend"), interest = sum("interest");
  const daysToNext = Math.round((Date.parse(ty.next) - Date.parse(today)) / 86400000);
  const byTicker = {};
  for (const e of inYear.filter((x) => x.kind === "dividend" && x.ticker)) byTicker[e.ticker] = Math.round(((byTicker[e.ticker] || 0) + e.amount) * 100) / 100;
  return { taxYear: ty.label, next: ty.next, daysToNext, deposits, withdrawals, dividends, interest, used: deposits, remaining: Math.max(0, Math.round((allowance - deposits) * 100) / 100), over: deposits > allowance, count: inYear.length, dividendsBy: Object.entries(byTicker).sort((a, b) => b[1] - a[1]) };
}

// Merge newly imported cash events into the saved list (by id).
export function mergeCash(saved = [], add = []) {
  const have = new Set(saved.map((e) => e.id));
  return [...saved, ...add.filter((e) => e?.id && !have.has(e.id))];
}
