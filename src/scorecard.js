// Picks vs the core so far (display only): would the money put into the picks
// pot have done better in VWRP? Each logged pick trade is shadowed by the same
// pounds in VWRP on the same day (VWRP closes from history/core-fund.json, kept
// by the monitor), and both sides are valued today. Runs in the browser on the
// trade log, which never leaves it. Not a rule: the yearly scorecard and the
// three-year review are proposals waiting on Douglas.

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Merge daily rows [{date, close}] into a stored {date: close} map (2 dp),
// returned with its dates in order so the file diffs cleanly.
export function mergeCloses(stored = {}, rows = []) {
  const out = { ...(stored || {}) };
  for (const r of rows || []) if (YMD.test(r?.date ?? "") && Number.isFinite(r.close) && r.close > 0) out[r.date] = Math.round(r.close * 100) / 100;
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

// Last close on or before `date` (no later than 7 days back, so a gap in the
// record is not papered over); null if none.
export function closeOn(closes = {}, date, maxGap = 7) {
  if (!YMD.test(date ?? "")) return null;
  const keys = Object.keys(closes || {}).filter((d) => d <= date).sort();
  const k = keys.at(-1);
  if (!k || (Date.parse(date) - Date.parse(k)) / 86400000 > maxGap) return null;
  return closes[k];
}

// trades: the trade log. closes: VWRP closes in pounds. prices: today's pick
// prices in quote units (as the trade log's price paid), keyed without ".L".
// coreNow: today's VWRP level (falls back to the last close).
export function picksVsCore(trades = [], closes = {}, prices = {}, coreNow = null) {
  const keys = Object.keys(closes || {}).sort();
  const now = coreNow > 0 ? coreNow : closes[keys.at(-1)];
  if (!(now > 0)) return null;
  const by = {};
  let skipped = 0, since = null;
  for (const t of trades || []) {
    if (t?.pot !== "picks" || !(t.amount > 0) || !t.ticker) continue;
    const px = prices[t.ticker.replace(/\.L$/, "")], core = closeOn(closes, t.date);
    if (!(t.price > 0) || !(px > 0) || !(core > 0)) { skipped++; continue; }
    const s = t.action === "sell" ? -1 : 1;
    const b = (by[t.ticker] ||= { ticker: t.ticker, paid: 0, picks: 0, core: 0 });
    if (s > 0) b.paid += t.amount;
    b.picks += s * t.amount * (px / t.price);
    b.core += s * t.amount * (now / core);
    if (!since || t.date < since) since = t.date;
  }
  const rows = Object.values(by).filter((b) => b.paid > 0);
  if (!rows.length) return { counted: 0, skipped };
  const sum = (k) => rows.reduce((a, b) => a + b[k], 0);
  const paid = sum("paid"), picks = sum("picks"), core = sum("core");
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    since, paid: Math.round(paid), picks: Math.round(picks), core: Math.round(core),
    picksPct: r1((picks / paid - 1) * 100), corePct: r1((core / paid - 1) * 100), gap: Math.round(picks - core),
    counted: rows.length, skipped,
    rows: rows.map((b) => ({ ticker: b.ticker, paid: Math.round(b.paid), gap: Math.round(b.picks - b.core), picksPct: r1((b.picks / b.paid - 1) * 100), corePct: r1((b.core / b.paid - 1) * 100) })).sort((a, b) => b.gap - a.gap),
  };
}

// One plain line for the panel.
export function scorecardLine(sc) {
  if (!sc?.counted) return null;
  const s = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
  const ahead = sc.gap >= 0;
  return `Picks ${s(sc.picksPct)} vs the same money in VWRP ${s(sc.corePct)}: ${ahead ? "ahead" : "behind"} by £${Math.abs(sc.gap).toLocaleString("en-GB")}.`;
}
