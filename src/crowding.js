// Good entries that move together (display only).
// Several "good entries" can be one bet: on 12 Nov four of the top five were
// storage and memory names that fell together after one shock. This groups
// stocks whose daily returns over the last 60 sessions are highly correlated,
// so the Research page can say "treat these as one idea".
// Works in the browser and in Node (no imports).

export const CROWD = { window: 60, link: 0.6, keep: 0.5 };

// Daily returns from a series rebased to 0 (cumulative %, as in `rebase()`).
export function dailyReturns(series) {
  if (!Array.isArray(series) || series.length < 2) return [];
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= -100) return [];
    out.push((1 + b / 100) / (1 + a / 100) - 1);
  }
  return out;
}

export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return sx > 1e-12 && sy > 1e-12 ? sxy / Math.sqrt(sx * sy) : null;
}

const round2 = (v) => Math.round(v * 100) / 100;

// Returns for items that can be compared: same market and same last date, enough history.
function usable(items, window) {
  const out = [];
  for (const it of items || []) {
    const r = dailyReturns(it?.series);
    if (r.length >= window) out.push({ it, key: `${it.market || ""}|${it.date || ""}`, r: r.slice(-window) });
  }
  return out;
}

// Pairwise correlation lookup between usable items (same market and date only).
function pairs(rows) {
  const m = new Map();
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (rows[i].key !== rows[j].key) continue;
    const c = correlation(rows[i].r, rows[j].r);
    if (c == null) continue;
    m.set(`${i}|${j}`, c); m.set(`${j}|${i}`, c);
  }
  return m;
}

// Groups of 2+ stocks that move together. Linked when a pair's correlation is at
// least `link`; a member whose average correlation with the rest of its group is
// under `keep` is dropped (stops long chains through one loosely tied name).
export function moveTogether(items, opts = {}) {
  const { window, link, keep } = { ...CROWD, ...opts };
  const rows = usable(items, window), C = pairs(rows);
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [k, c] of C) { if (c < link) continue; const [i, j] = k.split("|").map(Number); parent[find(i)] = find(j); }
  const byRoot = new Map();
  rows.forEach((_, i) => { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(i); });
  const groups = [];
  for (let members of byRoot.values()) {
    if (members.length < 2) continue;
    for (;;) {
      const avgs = members.map((i) => members.filter((j) => j !== i).reduce((s, j) => s + (C.get(`${i}|${j}`) ?? 0), 0) / (members.length - 1));
      const worst = avgs.indexOf(Math.min(...avgs));
      if (members.length > 2 && avgs[worst] < keep) { members = members.filter((_, k) => k !== worst); continue; }
      break;
    }
    if (members.length < 2) continue;
    let s = 0, n = 0;
    for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++) { s += C.get(`${members[a]}|${members[b]}`) ?? 0; n++; }
    const avg = s / n;
    if (avg < keep) continue;
    const its = members.map((i) => rows[i].it);
    const sectors = {};
    for (const it of its) if (it.sector) sectors[it.sector] = (sectors[it.sector] || 0) + 1;
    const top = Object.entries(sectors).sort((a, b) => b[1] - a[1])[0];
    groups.push({
      symbols: its.map((it) => it.symbol),
      market: its[0].market || null,
      avgCorr: round2(avg),
      sector: top && top[1] * 2 > its.length ? top[0] : null,
      allSector: !!top && top[1] === its.length,
      industries: [...new Set(its.map((it) => it.industry).filter(Boolean))],
    });
  }
  return groups.sort((a, b) => b.symbols.length - a.symbols.length || b.avgCorr - a.avgCorr);
}

// The stocks a given item moves with most (correlation >= link), strongest first.
export function movesWith(item, items, opts = {}) {
  const { window, link, max = 4 } = { ...CROWD, ...opts };
  const me = dailyReturns(item?.series);
  if (me.length < window) return [];
  const key = `${item.market || ""}|${item.date || ""}`, mine = me.slice(-window), out = [];
  for (const it of items || []) {
    if (!it || it.symbol === item.symbol || `${it.market || ""}|${it.date || ""}` !== key) continue;
    const r = dailyReturns(it.series);
    if (r.length < window) continue;
    const c = correlation(mine, r.slice(-window));
    if (c != null && c >= link) out.push({ symbol: it.symbol, corr: round2(c), verdict: it.longTerm?.verdict || null });
  }
  return out.sort((a, b) => b.corr - a.corr).slice(0, max);
}

const NUM = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n) => NUM[n] || String(n);

// One plain sentence for the good entries, or null when they are not crowded.
// Says how many of them are really one bet.
export function crowdingNote(items, opts = {}) {
  const { window = CROWD.window } = opts;
  const good = (items || []).filter((it) => it?.longTerm?.verdict === "Good entry");
  if (good.length < 3) return null;
  const groups = moveTogether(good, opts).filter((g) => g.symbols.length >= 3 || g.symbols.length * 3 >= good.length);
  if (!groups.length) return null;
  const parts = groups.map((g) => `${g.symbols.join(", ")}${g.sector ? ` (${g.allSector ? (g.symbols.length === 2 ? "both" : "all") : "mostly"} ${g.sector})` : ""}, average daily correlation ${g.avgCorr.toFixed(2)}`);
  const inGroups = groups.reduce((s, g) => s + g.symbols.length, 0);
  const ideas = good.length - inGroups + groups.length;
  return {
    groups,
    good: good.length,
    ideas,
    text: `${inGroups} of the ${good.length} good entries move together over the last ${window} sessions: ${parts.join("; ")}. They tend to rise and fall together, so count each group as one idea: about ${word(ideas)} separate idea${ideas === 1 ? "" : "s"}, not ${word(good.length)}.`,
  };
}

// Picks and bench that move with a pick (display only). The plan wants picks in
// different sectors and replacements from sectors the pot doesn't own; a bench
// name that moves with a pick would add to a bet the pot already holds.
export function planOverlap(items, picks = [], bench = [], opts = {}) {
  const { link = CROWD.link } = opts;
  const by = new Map((items || []).map((it) => [it.symbol, it]));
  const P = picks.filter((s) => by.has(s)), B = bench.filter((s) => by.has(s));
  const out = [];
  for (const p of P) {
    for (const m of movesWith(by.get(p), [...P, ...B].map((s) => by.get(s)), { ...opts, link, max: 10 })) {
      const pick = P.includes(m.symbol);
      if (pick && m.symbol < p) continue; // each pick pair once
      out.push(pick ? { a: p, b: m.symbol, corr: m.corr, pick } : { a: m.symbol, b: p, corr: m.corr, pick });
    }
  }
  return out.sort((x, y) => Number(y.pick) - Number(x.pick) || y.corr - x.corr);
}

export function planOverlapNote(pairs) {
  if (!pairs?.length) return null;
  const fmt = (x) => `${x.a} with ${x.b} (${x.corr.toFixed(2)})`;
  const pk = pairs.filter((x) => x.pick), bn = pairs.filter((x) => !x.pick);
  const s = [];
  if (pk.length) s.push(`Picks that move together: ${pk.map(fmt).join(", ")}; the pot is less spread than five names suggest.`);
  if (bn.length) s.push(`Bench names that move with a pick: ${bn.map(fmt).join(", ")}; if one replaced a different pick, the pot would hold that bet twice.`);
  return s.join(" ");
}
