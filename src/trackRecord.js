// Track record: every alert is logged with the price at the time, then scored
// against what actually happened next (and against the S&P 500 over the same
// period), so you can judge whether the signals are worth acting on.

const HORIZONS = [["w1", 5], ["m1", 21], ["m3", 63]];
// For these kinds a falling price afterwards means the call was right.
export const DOWN_IS_GOOD = new Set(["greed", "trim"]);

export const KIND_LABEL = {
  buy: "Buy tier", watch: "Watch tier", "fear-no-dip": "Fear without a dip", greed: "Greed: stop adding", trim: "Trim",
  "research-lt": "Long-term good entry", "research-swing": "Swing setup", smart: "Smart money: new or added",
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

// Home index for a symbol: UK listings are judged against the FTSE 100, the
// rest against the S&P 500 (Euro Stoxx when its rows are passed in).
export function homeIndex(symbol) {
  if (/\.L$/.test(symbol) || symbol === "^FTSE") return "^FTSE";
  if (/\.(DE|PA|AS|MI|MC|BR|HE)$/.test(symbol) || symbol === "^STOXX50E") return "^STOXX50E";
  return "^GSPC";
}

// Returns from the alert price to n sessions later, and to the latest price.
// rowsBySymbol: { symbol: [{date, close}] }. Missing rows keep earlier results.
// Besides the S&P, each signal is also compared with its home index (idx*
// fields), when that index's rows are in rowsBySymbol; an index signal is not
// compared with itself.
export function evaluate(log, rowsBySymbol, spRows) {
  const spIdx = spRows ? new Map(spRows.map((r, i) => [r.date, i])) : null;
  const spAt = (date) => { // S&P close on or after a date
    if (!spRows) return null;
    const i = spRows.findIndex((r) => r.date >= date);
    return i >= 0 ? i : null;
  };
  const closeOnOrAfter = (rows, date) => rows?.find((r) => r.date >= date)?.close ?? null;
  const closeOnOrBefore = (rows, date) => { for (let i = (rows?.length ?? 0) - 1; i >= 0; i--) if (rows[i].date <= date) return rows[i].close; return null; };
  return log.map((s) => {
    const rows = rowsBySymbol[s.symbol];
    if (!rows?.length) return s;
    const i0 = rows.findIndex((r) => r.date >= s.date);
    if (i0 < 0) return s;
    const last = rows[rows.length - 1];
    const perf = { now: pct(last.close, s.price), nowDate: last.date, sessions: rows.length - 1 - i0 };
    const sp0 = spAt(s.date);
    if (sp0 != null) perf.spNow = pct(spRows[spRows.length - 1].close, spRows[sp0].close);
    let home = homeIndex(s.symbol);
    if (home === "^STOXX50E" && !rowsBySymbol[home]) home = "^GSPC";
    const hRows = home === s.symbol ? null : (rowsBySymbol[home] ?? (home === "^GSPC" ? spRows : null));
    const h0 = hRows ? closeOnOrAfter(hRows, s.date) : null;
    const hRet = (date) => { const c = h0 != null ? closeOnOrBefore(hRows, date) : null; return c == null ? null : pct(c, h0); };
    if (h0 != null) { perf.idx = home; perf.idxNow = hRet(last.date); }
    for (const [k, n] of HORIZONS) {
      const r = rows[i0 + n];
      if (!r) continue;
      perf[k] = pct(r.close, s.price);
      const j = spIdx?.get(r.date);
      if (sp0 != null && j != null) perf[`${k}Sp`] = pct(spRows[j].close, spRows[sp0].close);
      if (h0 != null) { const v = hRet(r.date); if (v != null) perf[`${k}Idx`] = v; }
    }
    if (perf.now != null && perf.spNow != null) perf.vsSp = Math.round((perf.now - perf.spNow) * 10) / 10;
    if (perf.now != null && perf.idxNow != null) perf.vsIdx = Math.round((perf.now - perf.idxNow) * 10) / 10;
    return { ...s, perf };
  });
}

// Headline numbers: hit rate at one month (or "so far" if nothing is a month old yet).
// Each signal against its home index (FTSE 100 for London, Euro Stoxx 50 for
// Europe, else the S&P 500); the S&P when the home index is missing.
export const vsHome = (p) => p?.vsIdx ?? p?.vsSp ?? null;
export const INDEX_SHORT = { "^GSPC": "S&P", "^FTSE": "FTSE", "^STOXX50E": "Stoxx" };

export function summarise(log) {
  // A signal needs at least a week of trading before it says anything.
  const scored = log.filter((s) => s.perf?.now != null && (s.perf.sessions ?? 0) >= 5);
  const right = (s, v) => (DOWN_IS_GOOD.has(s.kind) ? v < 0 : v > 0);
  const m1 = scored.filter((s) => s.perf.m1 != null);
  const basis = m1.length >= 3 ? "m1" : "now";
  const pool = basis === "m1" ? m1 : scored;
  const hits = pool.filter((s) => right(s, s.perf[basis])).length;
  const beat = pool.filter((s) => s.perf.vsSp != null && (DOWN_IS_GOOD.has(s.kind) ? s.perf.vsSp < 0 : s.perf.vsSp > 0)).length;
  const beatH = pool.filter((s) => vsHome(s.perf) != null && (DOWN_IS_GOOD.has(s.kind) ? vsHome(s.perf) < 0 : vsHome(s.perf) > 0)).length;
  return {
    total: log.length, scored: pool.length, basis,
    hitRate: pool.length ? Math.round((hits / pool.length) * 100) : null,
    beatSp: pool.length ? Math.round((beat / pool.length) * 100) : null,
    beatIdx: pool.length ? Math.round((beatH / pool.length) * 100) : null,
    since: log[0]?.date ?? null,
  };
}

// Per signal type: the same headline numbers for each kind, plus the average
// return against the S&P. A kind needs MIN_PER_KIND scored signals before its
// rates mean anything; below that the page says "too early".
export const MIN_PER_KIND = 5;
export function byKind(log) {
  const groups = Object.groupBy(log || [], (s) => s.kind);
  return Object.entries(groups).map(([kind, list]) => {
    const s = summarise(list);
    const pool = list.filter((x) => x.perf?.now != null && (x.perf.sessions ?? 0) >= 5 && x.perf.vsSp != null && (s.basis !== "m1" || x.perf.m1 != null));
    const avg = pool.length ? Math.round((pool.reduce((a, x) => a + x.perf.vsSp, 0) / pool.length) * 10) / 10 : null;
    const avgIdx = pool.length ? Math.round((pool.reduce((a, x) => a + vsHome(x.perf), 0) / pool.length) * 10) / 10 : null;
    const enough = s.scored >= MIN_PER_KIND;
    return { kind, label: KIND_LABEL[kind] || kind, total: s.total, scored: s.scored, basis: s.basis, enough,
      hitRate: enough ? s.hitRate : null, beatSp: enough ? s.beatSp : null, avgVsSp: enough ? avg : null,
      beatIdx: enough ? s.beatIdx : null, avgVsIdx: enough ? avgIdx : null };
  }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

// --- Detail views (slice 2): by market, by score band, by horizon ------------
// All compare with the signal's home index (FTSE 100 for UK listings), as a
// UK stock against the S&P mostly measures the pound and the US market.
const right = (s, v) => (DOWN_IS_GOOD.has(s.kind) ? v < 0 : v > 0);
const avg1 = (xs) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
const r0 = (n, d) => d ? Math.round((n / d) * 100) : null;

// One group's numbers at a basis: "now" (since the signal) or a horizon key.
function groupStats(list, basis) {
  const val = (x) => basis === "now" ? x.perf?.now : x.perf?.[basis];
  const ref = (x) => basis === "now" ? x.perf?.idxNow : x.perf?.[`${basis}Idx`];
  const pool = list.filter((x) => val(x) != null && (basis !== "now" || (x.perf.sessions ?? 0) >= 5));
  const withRef = pool.filter((x) => ref(x) != null);
  const ex = withRef.map((x) => val(x) - ref(x));
  const enough = pool.length >= MIN_PER_KIND;
  return {
    total: list.length, scored: pool.length, enough,
    hitRate: enough ? r0(pool.filter((x) => right(x, val(x))).length, pool.length) : null,
    beatIdx: enough && withRef.length ? r0(withRef.filter((x, i) => DOWN_IS_GOOD.has(x.kind) ? ex[i] < 0 : ex[i] > 0).length, withRef.length) : null,
    avgVsIdx: enough ? avg1(ex) : null,
    avgReturn: enough ? avg1(pool.map(val)) : null,
  };
}
// Basis for a group: one month once 3 signals have it, else since the signal.
const basisFor = (list) => list.filter((x) => x.perf?.m1 != null).length >= 3 ? "m1" : "now";

export const MARKET_LABEL = { US: "US stocks", UK: "UK stocks", EU: "European stocks", IDX: "Market-wide (index)" };
export function marketOfSymbol(sym) {
  if (/^\^/.test(sym)) return "IDX";
  const h = homeIndex(sym);
  return h === "^FTSE" ? "UK" : h === "^STOXX50E" ? "EU" : "US";
}
export function byMarket(log) {
  const groups = Object.groupBy(log || [], (s) => marketOfSymbol(s.symbol));
  return Object.entries(groups).map(([market, list]) => {
    const basis = basisFor(list);
    return { market, label: MARKET_LABEL[market], basis, ...groupStats(list, basis) };
  }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

// Score bands from the label ("Swing setup (78)"); only research signals carry one.
export const SCORE_BANDS = [["80+", 80, Infinity], ["70 to 79", 70, 80], ["under 70", -Infinity, 70]];
export function scoreOf(s) {
  const m = /\((\d{1,3})\)\s*$/.exec(s?.label || "");
  return m ? Number(m[1]) : null;
}
export function byScore(log) {
  const scored = (log || []).filter((s) => scoreOf(s) != null);
  return SCORE_BANDS.map(([band, lo, hi]) => {
    const list = scored.filter((s) => { const v = scoreOf(s); return v >= lo && v < hi; });
    const basis = basisFor(list);
    return { band, basis, ...groupStats(list, basis) };
  }).filter((g) => g.total);
}

// For each signal type, results at one week, one month and three months side by side.
export const HORIZON_LABEL = { w1: "1 week", m1: "1 month", m3: "3 months" };
export function byHorizon(log) {
  const groups = Object.groupBy(log || [], (s) => s.kind);
  return Object.entries(groups).map(([kind, list]) => ({
    kind, label: KIND_LABEL[kind] || kind, total: list.length,
    horizons: HORIZONS.map(([k]) => ({ key: k, label: HORIZON_LABEL[k], ...groupStats(list, k) })),
  })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

// One line per signal type for the Sunday digest.
export function digestKindLine(kinds) {
  if (!kinds?.length) return null;
  const ready = kinds.filter((g) => g.enough);
  if (!ready.length) {
    const top = kinds.reduce((a, b) => (b.scored > a.scored ? b : a));
    return `By type: too early for all ${kinds.length} (each needs ${MIN_PER_KIND} scored; closest: ${top.label}, ${top.scored} of ${MIN_PER_KIND}).`;
  }
  return "By type: " + ready.map((g) => `${g.label} ${g.hitRate}% right${g.basis === "m1" ? " after a month" : " so far"}, avg ${g.avgVsIdx > 0 ? "+" : ""}${g.avgVsIdx}% vs its index (${g.scored})`).join("; ")
    + (ready.length < kinds.length ? `; ${kinds.length - ready.length} other type${kinds.length - ready.length === 1 ? "" : "s"} too early.` : ".");
}
