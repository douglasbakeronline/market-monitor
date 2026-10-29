// Track record: every alert is logged with the price at the time, then scored
// against what actually happened next (and against the S&P 500 over the same
// period), so you can judge whether the signals are worth acting on.

const HORIZONS = [["w1", 5], ["m1", 21], ["m3", 63]];
// For these kinds a falling price afterwards means the call was right.
export const DOWN_IS_GOOD = new Set(["greed", "trim"]);

export const KIND_LABEL = {
  buy: "Buy tier", watch: "Watch tier", "fear-no-dip": "Fear without a dip", greed: "Greed: stop adding", trim: "Trim",
  "research-lt": "Long-term good entry", "research-swing": "Swing setup",
};

// Add new events (deduped on kind + symbol + date).
export function logSignals(log, events) {
  const out = [...(log || [])];
  const seen = new Set(out.map((s) => s.id));
  for (const e of events) {
    if (!e?.symbol || !Number.isFinite(e.price) || !e.date) continue;
    const id = `${e.date}:${e.kind}:${e.symbol}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, ...e });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);

// Returns from the alert price to n sessions later, and to the latest price.
// rowsBySymbol: { symbol: [{date, close}] }. Missing rows keep earlier results.
export function evaluate(log, rowsBySymbol, spRows) {
  const spIdx = spRows ? new Map(spRows.map((r, i) => [r.date, i])) : null;
  const spAt = (date) => { // S&P close on or after a date
    if (!spRows) return null;
    const i = spRows.findIndex((r) => r.date >= date);
    return i >= 0 ? i : null;
  };
  return log.map((s) => {
    const rows = rowsBySymbol[s.symbol];
    if (!rows?.length) return s;
    const i0 = rows.findIndex((r) => r.date >= s.date);
    if (i0 < 0) return s;
    const last = rows[rows.length - 1];
    const perf = { now: pct(last.close, s.price), nowDate: last.date, sessions: rows.length - 1 - i0 };
    const sp0 = spAt(s.date);
    if (sp0 != null) perf.spNow = pct(spRows[spRows.length - 1].close, spRows[sp0].close);
    for (const [k, n] of HORIZONS) {
      const r = rows[i0 + n];
      if (!r) continue;
      perf[k] = pct(r.close, s.price);
      const j = spIdx?.get(r.date);
      if (sp0 != null && j != null) perf[`${k}Sp`] = pct(spRows[j].close, spRows[sp0].close);
    }
    if (perf.now != null && perf.spNow != null) perf.vsSp = Math.round((perf.now - perf.spNow) * 10) / 10;
    return { ...s, perf };
  });
}

// Headline numbers: hit rate at one month (or "so far" if nothing is a month old yet).
export function summarise(log) {
  // A signal needs at least a week of trading before it says anything.
  const scored = log.filter((s) => s.perf?.now != null && (s.perf.sessions ?? 0) >= 5);
  const right = (s, v) => (DOWN_IS_GOOD.has(s.kind) ? v < 0 : v > 0);
  const m1 = scored.filter((s) => s.perf.m1 != null);
  const basis = m1.length >= 3 ? "m1" : "now";
  const pool = basis === "m1" ? m1 : scored;
  const hits = pool.filter((s) => right(s, s.perf[basis])).length;
  const beat = pool.filter((s) => s.perf.vsSp != null && (DOWN_IS_GOOD.has(s.kind) ? s.perf.vsSp < 0 : s.perf.vsSp > 0)).length;
  return {
    total: log.length, scored: pool.length, basis,
    hitRate: pool.length ? Math.round((hits / pool.length) * 100) : null,
    beatSp: pool.length ? Math.round((beat / pool.length) * 100) : null,
    since: log[0]?.date ?? null,
  };
}
