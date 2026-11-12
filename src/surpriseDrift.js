// Swing lab round 6 (12 Nov 2026): results drift on REAL results days, with
// the analysts' surprise. Douglas, 12 Nov: "develop the results ahead feature,
// make it better for gains". The pot's drift setup spots results by volume
// (a 4%+ close on 3x normal volume), and round 5 found volume names the
// results day only 36 to 43% of the time. Yahoo holds about ten years of real,
// timed results dates with the EPS forecast and actual (fetchResultsHistory),
// so the drift literature can be tested properly: drift is stronger after big
// analyst-based surprises (Bernard and Thomas 1989; Livnat and Mendenhall
// 2006), and round 4's one-year hint (strong surprise + rise did better) can
// be checked on ten years.
//
// Events: each real results reaction day (after-close reporters: the next
// session). Buy the next open, hold 20 sessions (the pot's rule) or 60, after
// costs (US 0.3%, UK 0.5% round trip). Random baseline: about 1 day in 10 on
// the same stocks, same holds.
//
// Pre-registered BEFORE the run (nothing tuned afterwards):
//   H8 (beat filter, the pot): results days that close up 4%+ AND beat the
//     forecast by 5%+ ("jump with a beat") clear the round-1 bar at 20
//     sessions (LAB_BAR: edge 0.4+, positive after costs, 300+ trades, ahead
//     in 3 of 4 years with 50+, in each market with 100+, in both halves, and
//     ahead of random holds started in the same month), AND their edge beats
//     the pot's current trigger on results days (4%+ on 3x volume) by 0.3+.
//   H9 (results days only, the pot): the pot's current trigger on real
//     results days beats the same trigger on days with no results within two
//     sessions by 0.3+ points at 20 sessions, and in both halves.
//   H7 (the literature, informative): the top fifth of surprise beats the
//     bottom fifth, against the home index, by 2+ points at 60 sessions, and
//     is ahead at 20 sessions in 3 of 4 years with 100+ events.
//   D2 (data): 60%+ of US events carry a surprise, or H7 and H8 read
//     "surprise data thin".
// Exploratory only: jumps without a big beat, big beats without a jump.
// Caveats in advance: today's index members only; Yahoo's dates and forecasts
// are thin for UK half-yearly reporters; overlapping holds in results season.
import { r2 } from "./util.js";
import { COSTS } from "./swingRetune.js";
import { LAB_BAR } from "./swingLab.js";

export const SD = { horizons: [20, 60], jump: 0.04, volX: 3, beat: 5, near: 2 };

// One stock. rows: daily bars; events: [{ date, after, surprisePct }];
// idx: Map date -> home index close.
export function surpriseDriftEvents(rows, market, events = [], { idx = null, seed = 1, symbol = null } = {}) {
  const n = rows.length, cost = COSTS[market] ?? 0, H = SD.horizons;
  let x = seed >>> 0;
  const rand = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const vAvg = new Array(n).fill(null);
  let s = 0;
  for (let i = 0; i < n; i++) { if (i >= 50) vAvg[i] = s / 50; s += rows[i].volume || 0; if (i >= 50) s -= rows[i - 50].volume || 0; }
  const fwd = (d) => {
    const entry = rows[d + 1]?.open;
    if (!(entry > 0)) return null;
    const f = {};
    for (const h of H) { const k = d + h; f[h] = k < n ? r2((rows[k].close / entry - 1 - cost) * 100) : null; }
    return f;
  };
  const base = (d) => ({ symbol, market, date: rows[d].date, month: rows[d].date.slice(0, 7), year: rows[d].date.slice(0, 4) });
  const out = [];
  // Results reaction days.
  const resDays = new Map();
  for (const e of events) {
    const i = rows.findIndex((r) => (e.after === true ? r.date > e.date : r.date >= e.date));
    if (i >= 60 && i < n - 1 && !resDays.has(i)) resDays.set(i, e);
  }
  const nearResults = (d) => { for (const i of resDays.keys()) if (Math.abs(i - d) <= SD.near) return true; return false; };
  for (let d = 60; d < n - 1; d++) {
    const ret = rows[d].close / rows[d - 1].close - 1, volX = vAvg[d] > 0 ? (rows[d].volume || 0) / vAvg[d] : null;
    if (resDays.has(d)) {
      const e = resDays.get(d), f = fwd(d);
      if (f) out.push({ ...base(d), kind: "results", move: r2(ret * 100), volX: volX == null ? null : r2(volX), surprisePct: e.surprisePct ?? null, f, fx: idxRel(f, d) });
    } else if (volX != null && volX >= SD.volX && ret >= SD.jump && !nearResults(d)) {
      const f = fwd(d);
      if (f) out.push({ ...base(d), kind: "shock", move: r2(ret * 100), volX: r2(volX), f, fx: idxRel(f, d) });
    }
    if (rand() < 0.1) { const f = fwd(d); if (f) out.push({ ...base(d), kind: "random", f, fx: idxRel(f, d) }); }
  }
  return out;
  function idxRel(f, d) {
    const o = {};
    for (const h of H) { const k = d + h, a = idx?.get(rows[d].date), b = k < n ? idx?.get(rows[k].date) : null; o[h] = f[h] != null && a && b ? r2(f[h] - (b / a - 1) * 100) : null; }
    return o;
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
const isJump = (e) => e.kind === "results" && e.move >= SD.jump * 100;
export const GROUPS = {
  current: (e) => isJump(e) && e.volX != null && e.volX >= SD.volX,
  jumpBeat: (e) => isJump(e) && e.surprisePct != null && e.surprisePct >= SD.beat,
  jumpRest: (e) => isJump(e) && e.surprisePct != null && e.surprisePct < SD.beat,
  beatNoJump: (e) => e.kind === "results" && e.surprisePct != null && e.surprisePct >= SD.beat && e.move >= 0 && e.move < SD.jump * 100,
  shock: (e) => e.kind === "shock",
};

export function analyseSurpriseDrift(all, { bar = LAB_BAR, h = 20 } = {}) {
  const rnd = all.filter((e) => e.kind === "random"), years = [...new Set(all.map((e) => e.year))].sort();
  const cmp = (evs, base, hh = h) => {
    const a = evs.map((e) => e.f[hh]).filter((v) => v != null), b = base.map((e) => e.f[hh]).filter((v) => v != null), ma = mean(a), mb = mean(b);
    return { n: a.length, avg: r2(ma), base: r2(mb), edge: ma != null && mb != null ? r2(ma - mb) : null, win: a.length ? Math.round((a.filter((v) => v > 0).length / a.length) * 100) : null };
  };
  const mm = new Map();
  for (const e of rnd) { if (e.f[h] == null) continue; const g = mm.get(e.month) || [0, 0]; g[0] += e.f[h]; g[1]++; mm.set(e.month, g); }
  const monthEdge = (evs) => { const xs = evs.filter((e) => e.f[h] != null).map((e) => { const g = mm.get(e.month); return g && g[1] >= 20 ? e.f[h] - g[0] / g[1] : null; }).filter((v) => v != null); return xs.length ? r2(mean(xs)) : null; };
  const table = (key) => {
    const ev = all.filter(GROUPS[key]);
    const t = cmp(ev, rnd);
    const byYear = years.map((y) => ({ year: y, ...cmp(ev.filter((e) => e.year === y), rnd.filter((e) => e.year === y)) }));
    const byMarket = ["US", "UK"].map((m) => ({ market: m, ...cmp(ev.filter((e) => e.market === m), rnd.filter((e) => e.market === m)) }));
    const halves = [["2017-2021", (e) => e.year <= "2021"], ["2022-2026", (e) => e.year >= "2022"]].map(([label, f]) => ({ label, ...cmp(ev.filter(f), rnd.filter(f)) }));
    const counted = byYear.filter((r) => r.n >= bar.minYearTrades && r.edge != null), ahead = counted.filter((r) => r.edge > 0).length;
    return { ...t, h60: cmp(ev, rnd, 60), vsIdx20: r2(mean(ev.map((e) => e.fx[20]).filter((v) => v != null))), monthEdge: monthEdge(ev), byYear, byMarket, halves, years: { ahead, counted: counted.length } };
  };
  const T = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, table(k)]));
  const lab = (t) => ({
    edge: t.edge != null && t.edge >= bar.minEdge, positive: t.avg != null && t.avg > 0, sample: t.n >= bar.minTrades,
    years: t.years.counted > 0 && t.years.ahead / t.years.counted >= bar.yearShare,
    markets: t.byMarket.filter((m) => m.n >= 100).every((m) => m.edge > 0), halves: t.halves.every((x) => x.edge != null && x.edge > 0), month: t.monthEdge != null && t.monthEdge > 0,
  });
  const res = all.filter((e) => e.kind === "results"), us = res.filter((e) => e.market === "US");
  const D2 = { usEvents: us.length, withSurprise: us.filter((e) => e.surprisePct != null).length };
  D2.share = us.length ? r2(D2.withSurprise / us.length) : null;
  D2.pass = D2.share != null && D2.share >= 0.6;

  const h8c = { ...lab(T.jumpBeat), vsCurrent: T.jumpBeat.edge != null && T.current.edge != null && T.jumpBeat.edge - T.current.edge >= 0.3 };
  const H8 = { checks: h8c, pass: D2.pass && Object.values(h8c).every(Boolean), gain: T.jumpBeat.edge != null && T.current.edge != null ? r2(T.jumpBeat.edge - T.current.edge) : null };
  const halfDiff = T.current.halves.map((x, i) => ({ label: x.label, diff: x.edge != null && T.shock.halves[i].edge != null ? r2(x.edge - T.shock.halves[i].edge) : null }));
  const H9 = { diff: T.current.edge != null && T.shock.edge != null ? r2(T.current.edge - T.shock.edge) : null, halves: halfDiff };
  H9.pass = H9.diff != null && H9.diff >= 0.3 && halfDiff.every((x) => x.diff != null && x.diff > 0);

  // H7: quintiles by surprise against the index.
  const sv = res.filter((e) => e.surprisePct != null).map((e) => e.surprisePct).sort((a, b) => a - b);
  const cut = (p) => sv[Math.min(sv.length - 1, Math.floor(p * sv.length))];
  const lo = cut(0.2), hi = cut(0.8);
  const top = res.filter((e) => e.surprisePct != null && e.surprisePct >= hi), bot = res.filter((e) => e.surprisePct != null && e.surprisePct <= lo);
  const rel = (xs, hh) => r2(mean(xs.map((e) => e.fx[hh]).filter((v) => v != null)));
  const h7y = years.map((y) => { const a = top.filter((e) => e.year === y), b = bot.filter((e) => e.year === y); return { year: y, n: a.length + b.length, spread20: a.length && b.length ? r2(rel(a, 20) - rel(b, 20)) : null }; });
  const h7c = h7y.filter((r) => r.n >= 100 && r.spread20 != null);
  const H7 = { cuts: [r2(lo), r2(hi)], top60: rel(top, 60), bottom60: rel(bot, 60), spread60: r2(rel(top, 60) - rel(bot, 60)), spread20: r2(rel(top, 20) - rel(bot, 20)), byYear: h7y,
    years: { ahead: h7c.filter((r) => r.spread20 > 0).length, counted: h7c.length } };
  H7.pass = D2.pass && H7.spread60 >= 2 && h7c.length > 0 && H7.years.ahead / h7c.length >= bar.yearShare;
  return { D2, H7, H8, H9, groups: T, counts: Object.fromEntries(Object.keys(GROUPS).map((k) => [k, T[k].n])), random: rnd.length };
}
