// The core fund itself (VWRP), in pounds, next to the index the plan watches.
// Display only: the pullback rule and buy tiers still use the S&P 500 and FTSE 100.

// Correction and bear-market labels for a drawdown from the 52-week high.
export function drawdownTag(dd) {
  if (dd == null) return null;
  if (dd <= -20) return "Bear market";
  if (dd <= -10) return "Correction";
  return null;
}

// Pence or pounds, as Yahoo reports the listing.
export function fmtGbp(level, currency) {
  if (level == null) return null;
  return currency === "GBp" ? `${Math.round(level)}p` : `£${level.toFixed(2)}`;
}

// s: snapshot() of the fund; sp: snapshot() of the S&P 500 (or null).
export function coreFundView(s, sp, { symbol = "VWRP.L", name = "VWRP" } = {}) {
  if (!s || s.level == null || s.drawdownPct == null) return null;
  const dd = s.drawdownPct;
  const lead = dd > -0.5 ? `${name} is at or near its 52-week high` : `${name} is ${Math.abs(dd).toFixed(1)}% below its 52-week high`;
  let cmp = "";
  if (sp?.drawdownPct != null) {
    const gap = Math.round((dd - sp.drawdownPct) * 10) / 10;
    const spTxt = `the S&P 500's ${Math.abs(sp.drawdownPct).toFixed(1)}% in dollars`;
    if (Math.abs(gap) < 1) cmp = `, about the same as ${spTxt}`;
    else if (gap > 0) cmp = `, a smaller fall than ${spTxt} (other markets or the pound cushioned it)`;
    else cmp = `, a bigger fall than ${spTxt} (other markets or the pound added to it)`;
  }
  return {
    symbol, name, level: s.level, price: fmtGbp(s.level, s.currency), currency: s.currency, date: s.date,
    drawdownPct: dd, peak: s.peak, peakDate: s.peakDate, tag: drawdownTag(dd),
    dayPct: s.dayPct, weekPct: s.weekPct, monthPct: s.monthPct, ytdPct: s.ytdPct, vs200Pct: s.vs200Pct, above200: s.above200,
    spGap: sp?.drawdownPct != null ? Math.round((dd - sp.drawdownPct) * 10) / 10 : null,
    note: `${lead} in pounds${cmp}.`,
  };
}

// One line for the weekly digest.
export function coreFundLine(v) {
  if (!v) return null;
  const sg = (x) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
  return `Core fund (${v.name}): ${v.price}, ${v.drawdownPct.toFixed(1)}% from its high; week ${sg(v.weekPct)}, month ${sg(v.monthPct)}.`;
}

// Yahoo's daily bars for London listings sometimes miss the previous session
// early in the day (11 Nov 08:15: no 10 Nov bar), so the day change was
// measured over two sessions (+1.4% for +1.0%). Fill dates missing from the
// downloaded rows with the stored closes (history/core-fund.json); downloaded
// rows win where both exist. Only dates inside the downloaded window are
// filled, so a short download is not stretched with old history.
export function fillCloses(rows = [], stored = {}) {
  if (!rows?.length || !stored) return rows ?? [];
  const have = new Set(rows.map((r) => r.date));
  const first = rows[0].date, last = rows[rows.length - 1].date;
  const extra = Object.entries(stored)
    .filter(([d, c]) => d > first && d < last && !have.has(d) && Number.isFinite(c) && c > 0)
    .map(([date, close]) => ({ date, close, filled: true }));
  if (!extra.length) return rows;
  return [...rows, ...extra].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
