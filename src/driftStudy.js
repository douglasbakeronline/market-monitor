// Swing lab, round 2 (10 Nov 2026): a closer look at post-results drift, the
// one round-1 strategy that came close (research log). Hypotheses written
// down here BEFORE the run; nothing is tuned afterwards.
//   H1 (Bernard and Thomas 1989: drift runs for up to about 60 trading days)
//      Holding a +4%-on-3x-volume stock for 60 sessions clears the round-1
//      bar against random 60-session holds (LAB_BAR).
//   H2 (stability) The 20-session edge is positive in both halves of the
//      sample, 2017-2021 and 2022-2026, and in both markets.
//   H3 (for picks: buy after bad results, or wait?) After a -4% day on 3x
//      volume, the next 20 and 60 sessions do worse than random by at least
//      0.4 points, in 3 of every 4 years and in both markets. If so, a pick
//      tranche should wait after a bad results day.
// Exploratory only (shown, never a verdict): the 20-session edge by size of
// the move, by whether it opened with a gap, and by whether the home index
// was above its 200-day average.
import { r2 } from "./util.js";
import { COSTS } from "./swingRetune.js";
import { LAB_BAR } from "./swingLab.js";

export const HORIZONS = [5, 10, 20, 40, 60];
export const EVENT = { move: 0.04, volX: 3 };

// Events on one stock: each day the close moves 4%+ (up or down) on 3x the
// previous 50 sessions' volume. Forward net returns from the next open to the
// close h sessions later, after costs. Random baseline: about 1 in 10 days,
// same horizons. idx: Map date -> home index close (for the regime tag).
export function driftEvents(rows, market, { idx = null, seed = 1, symbol = null } = {}) {
  const n = rows.length, cost = COSTS[market] ?? 0, H = HORIZONS.at(-1);
  let x = seed >>> 0;
  const rand = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  // Index above its 200-day average, by date.
  let up = null;
  if (idx) {
    const ds = [...idx.keys()].sort(), cs = ds.map((d) => idx.get(d));
    up = new Map();
    let s = 0;
    for (let i = 0; i < cs.length; i++) { s += cs[i]; if (i >= 200) s -= cs[i - 200]; if (i >= 199) up.set(ds[i], cs[i] > s / 200); }
  }
  const fwd = (d) => {
    const e = d + 1, entry = rows[e]?.open;
    if (!(entry > 0)) return null;
    const out = {};
    for (const h of HORIZONS) { const k = e + h - 1; out[h] = k < n ? r2(((rows[k].close / entry - 1) - cost) * 100) : null; }
    return out;
  };
  const ev = [];
  let vs = 0;
  for (let d = 1; d < n - 1; d++) {
    if (d >= 51) vs += (rows[d - 1].volume || 0) - (rows[d - 51].volume || 0); else vs += rows[d - 1].volume || 0;
    if (d < 252) continue;
    const base = { symbol, market, date: rows[d].date, year: rows[d].date.slice(0, 4), regimeUp: up ? up.get(rows[d].date) ?? null : null };
    const avg = vs / 50, ret = rows[d].close / rows[d - 1].close - 1;
    if (avg > 0 && (rows[d].volume || 0) >= EVENT.volX * avg && Math.abs(ret) >= EVENT.move) {
      const f = fwd(d);
      if (f) ev.push({ ...base, kind: ret > 0 ? "up" : "down", move: r2(ret * 100), gap: r2((rows[d].open / rows[d - 1].close - 1) * 100), f });
    }
    if (rand() < 0.1) { const f = fwd(d); if (f) ev.push({ ...base, kind: "random", f }); }
  }
  return ev;
}

const mean = (xs) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
function cmp(evs, rnd, h) {
  const a = evs.map((e) => e.f[h]).filter((v) => v != null), b = rnd.map((e) => e.f[h]).filter((v) => v != null);
  const ma = mean(a), mb = mean(b);
  return { n: a.length, avg: r2(ma), base: r2(mb), edge: ma != null && mb != null ? r2(ma - mb) : null, win: a.length ? Math.round((a.filter((v) => v > 0).length / a.length) * 100) : null };
}

// Edge tables plus the hypothesis verdicts.
export function analyseDrift(all, bar = LAB_BAR) {
  const rnd = all.filter((e) => e.kind === "random"), years = [...new Set(all.map((e) => e.year))].sort();
  const sel = (xs, f) => xs.filter(f);
  const table = (kind, h, f = () => true) => cmp(sel(all, (e) => e.kind === kind && f(e)), sel(rnd, f), h);
  const byYear = (kind, h) => years.map((y) => ({ year: y, ...table(kind, h, (e) => e.year === y) }));
  const byMarket = (kind, h) => ["US", "UK"].map((m) => ({ market: m, ...table(kind, h, (e) => e.market === m) }));
  const consistent = (rows, sign) => {
    const c = rows.filter((r) => r.n >= bar.minYearTrades && r.edge != null);
    return { ahead: c.filter((r) => sign * r.edge > 0).length, counted: c.length, ok: c.length > 0 && c.filter((r) => sign * r.edge > 0).length / c.length >= bar.yearShare };
  };
  const horizons = (kind) => HORIZONS.map((h) => ({ h, ...table(kind, h) }));

  // H1: up events held 60 sessions clear the round-1 bar.
  const h1 = table("up", 60), h1y = byYear("up", 60), h1m = byMarket("up", 60), h1c = consistent(h1y, 1);
  const H1 = { ...h1, byYear: h1y, byMarket: h1m, years: h1c,
    checks: { edge: h1.edge >= bar.minEdge, positive: h1.avg > 0, sample: h1.n >= bar.minTrades, years: h1c.ok, markets: h1m.filter((m) => m.n >= 100).every((m) => m.edge > 0) } };
  H1.pass = Object.values(H1.checks).every(Boolean);

  // H2: 20-session edge positive in both halves and both markets.
  const halves = [["2017-2021", (e) => e.year <= "2021"], ["2022-2026", (e) => e.year >= "2022"]].map(([label, f]) => ({ label, ...table("up", 20, f) }));
  const H2 = { halves, byMarket: byMarket("up", 20), pass: halves.every((x) => x.edge > 0) && byMarket("up", 20).filter((m) => m.n >= 100).every((m) => m.edge > 0) };

  // H3: down events do worse than random by 0.4+ points at 20 and 60 sessions.
  const H3 = { by: [20, 60].map((h) => {
    const t = table("down", h), y = byYear("down", h), m = byMarket("down", h), c = consistent(y, -1);
    const checks = { edge: t.edge != null && t.edge <= -bar.minEdge, sample: t.n >= bar.minTrades, years: c.ok, markets: m.filter((r) => r.n >= 100).every((r) => r.edge < 0) };
    return { h, ...t, byYear: y, byMarket: m, years: c, checks, pass: Object.values(checks).every(Boolean) };
  }) };
  H3.pass = H3.by.every((b) => b.pass);

  // Exploratory cuts of the 20-session up-event edge.
  const explore = [
    ["Move +4 to 7%", (e) => e.move < 7], ["Move +7 to 12%", (e) => e.move >= 7 && e.move < 12], ["Move +12% or more", (e) => e.move >= 12],
    ["Opened with a 2%+ gap", (e) => e.gap >= 2], ["No big gap at the open", (e) => e.gap < 2],
    ["Index above its 200-day", (e) => e.regimeUp === true], ["Index below its 200-day", (e) => e.regimeUp === false],
  ].map(([label, f]) => {
    const evs = sel(all, (e) => e.kind === "up" && f(e));
    // Regime cuts compare with random days in the same regime; size and gap
    // cuts with all random days (random days have no move or gap).
    const base = label.startsWith("Index") ? sel(rnd, (e) => e.regimeUp === (label.includes("above"))) : rnd;
    return { label, ...cmp(evs, base, 20) };
  });

  // Placebo and matched baselines (added after the first run showed down
  // events ALSO beating random at 60 sessions, a sign the edge is partly
  // volatility, timing or survivorship rather than drift): each event against
  // random entries in the same calendar month (all stocks), and against the
  // same stock's random entries. Drift proper is up minus down.
  const groupMean = (key) => {
    const m = new Map();
    for (const e of rnd) for (const h of HORIZONS) { if (e.f[h] == null) continue; const k = `${key(e)}|${h}`; const g = m.get(k) || [0, 0]; g[0] += e.f[h]; g[1]++; m.set(k, g); }
    return (e, h) => { const g = m.get(`${key(e)}|${h}`); return g && g[1] >= 5 ? g[0] / g[1] : null; };
  };
  const byMonth = groupMean((e) => e.date.slice(0, 7)), byStock = groupMean((e) => e.symbol);
  const ex = (kind, h, base, f = () => true) => {
    const xs = all.filter((e) => e.kind === kind && f(e) && e.f[h] != null).map((e) => { const b = base(e, h); return b == null ? null : e.f[h] - b; }).filter((v) => v != null);
    return xs.length ? r2(mean(xs)) : null;
  };
  const matched = HORIZONS.map((h) => {
    const r = { h, upMonth: ex("up", h, byMonth), downMonth: ex("down", h, byMonth), upStock: ex("up", h, byStock), downStock: ex("down", h, byStock) };
    r.driftMonth = r.upMonth != null && r.downMonth != null ? r2(r.upMonth - r.downMonth) : null;
    r.driftStock = r.upStock != null && r.downStock != null ? r2(r.upStock - r.downStock) : null;
    return r;
  });
  const matchedYears = years.map((y) => ({ year: y, up: ex("up", 60, byMonth, (e) => e.year === y), down: ex("down", 60, byMonth, (e) => e.year === y), up20: ex("up", 20, byMonth, (e) => e.year === y) }));
  const matchedNo2020 = { up60: ex("up", 60, byMonth, (e) => e.year !== "2020"), down60: ex("down", 60, byMonth, (e) => e.year !== "2020"), up20: ex("up", 20, byMonth, (e) => e.year !== "2020") };

  return { matched, matchedYears, matchedNo2020, counts: { up: all.filter((e) => e.kind === "up").length, down: all.filter((e) => e.kind === "down").length, random: rnd.length },
    up: horizons("up"), down: horizons("down"), H1, H2, H3, explore };
}
