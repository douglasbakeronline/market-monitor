// Research: backtest the trim signal and the greed "stop adding" alert
// (src/trimBacktest.js, rules in src/config.js).
//   node tools/trim-backtest.mjs   -> prints JSON summary
// Data: S&P 500 price (^GSPC) for the rule, S&P 500 total return (^SP500TR,
// 1988 on) for returns and wealth, 13-week T-bill (^IRX) for cash, VIX (1990
// on), our CNN Fear & Greed history (2020 on) and a rebuilt proxy before that.
import { readFile } from "node:fs/promises";
import { parseYahoo } from "../src/data/prices.js";
import { fetchJson } from "../src/data/http.js";
import { CONFIG } from "../src/config.js";
import { align } from "../src/tierBacktest.js";
import { greedProxy, trimEpisodes, trimForward, trimRolling, corr, greedEpisodes, pauseRolling } from "../src/trimBacktest.js";

const daily = async (sym) => {
  const now = Math.floor(Date.now() / 1000);
  const j = await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=-1325635200&period2=${now}&interval=1d`, { tries: 2 });
  const { rows } = parseYahoo(j.chart.result[0]);
  if (rows.length < 2000) throw new Error(`only ${rows.length} daily bars for ${sym}`);
  console.error(`${sym}: ${rows.length} bars from ${rows[0].date}`);
  return rows;
};

const out = { rule: CONFIG.trim, notes: [] };
const [sp, tr, irx, vix] = await Promise.all(["^GSPC", "^SP500TR", "^IRX", "^VIX"].map((s) => daily(s).catch((e) => { out.notes.push(`${s}: ${e.message}`); return null; })));
let fgReal = {};
try { fgReal = JSON.parse(await readFile("history/fear-greed.json", "utf8")); } catch { out.notes.push("no F&G history"); }
// The first weeks of our history are a flat placeholder 50; use real values only.
const fgStart = Object.keys(fgReal).sort().find((d) => fgReal[d] !== 50) ?? "9999";
const t = CONFIG.trim;
const opt = { minScore: t.minScore, minAbove: t.minAbove200Pct, maxVix: t.maxVix, reset: t.resetScore };
const VARIANTS = {
  sell10_6m: { frac: 0.1, holdBars: 126 },
  sell10_12m: { frac: 0.1, holdBars: 252 },
  sell10_until200: { frac: 0.1, holdBars: 504, backBelow200: true },
  sell20_6m: { frac: 0.2, holdBars: 126 },
};

if (sp && tr && irx && vix) {
  const V = new Map(vix.map((r) => [r.date, r.close]));
  const base = align(sp, { tr, cash: irx }).map((r) => ({ ...r, vix: V.get(r.date) ?? null }));
  const proxy = greedProxy(base);
  const rows = base.map((r, i) => ({ ...r, fgProxy: proxy[i], fg: r.date >= fgStart ? fgReal[r.date] ?? null : null }));

  // 1. How well does the proxy track the real index?
  const ov = rows.filter((r) => r.fg != null && r.fgProxy != null);
  const freq = (xs, thr) => xs.filter((x) => x >= thr).length / xs.length;
  const realHi = freq(ov.map((r) => r.fg), t.minScore), realReset = freq(ov.map((r) => r.fg), t.resetScore);
  // Proxy level with the same share of days at or above it as F&G >= 80 (and >= 65) since 2020.
  const pAll = rows.map((r) => r.fgProxy).filter((x) => x != null).sort((a, b) => b - a);
  const pOv = ov.map((r) => r.fgProxy).sort((a, b) => b - a);
  const at = (xs, share) => xs[Math.min(xs.length - 1, Math.floor(share * xs.length))];
  const proxyHi = at(pOv, realHi), proxyReset = at(pOv, realReset);
  out.proxy = {
    overlapDays: ov.length, from: ov[0]?.date, corrDaily: corr(ov.map((r) => r.fg), ov.map((r) => r.fgProxy)),
    realDaysAt80Pct: Math.round(realHi * 1000) / 10, realDaysAt65Pct: Math.round(realReset * 1000) / 10,
    proxyLevelFor80: proxyHi, proxyLevelFor65: proxyReset,
    proxyDaysAtThatLevelSince1990Pct: Math.round(freq(pAll, proxyHi) * 1000) / 10,
  };

  const tr1990 = rows.filter((r) => r.date >= "1990-01-02");
  // 2. The live rule on real F&G (2020 on): few episodes, mostly descriptive.
  const real = rows.filter((r) => r.date >= fgStart || r.date >= "2019-01-01").map((r) => ({ ...r }));
  const sReal = trimEpisodes(real, { ...opt, warm: 0 });
  out.realRule_2020 = trimForward(real, sReal, { warm: real.findIndex((r) => r.fg != null) });
  // 3. The rule with the proxy standing in for F&G (1990 on), at matched frequency and at the raw 80/65.
  const px = tr1990.map((r) => ({ ...r, fg: r.fgProxy }));
  const sMatched = trimEpisodes(px, { ...opt, minScore: proxyHi, reset: proxyReset });
  const sRaw = trimEpisodes(px, opt);
  out.proxyRuleMatched_1990 = trimForward(px, sMatched);
  out.proxyRuleRaw80_1990 = trimForward(px, sRaw);
  // 4. Price and VIX only (no sentiment), 1990 on.
  const sPV = trimEpisodes(tr1990, { ...opt, useFg: false });
  out.priceVixOnly_1990 = trimForward(tr1990, sPV);
  // 5. Acting on it: sell part of the holding to T-bills at each episode, buy back later; 10-year windows.
  out.sim_1990 = {
    proxyMatched_y10: trimRolling(px, sMatched, VARIANTS, { years: 10 }),
    proxyMatched_y5: trimRolling(px, sMatched, VARIANTS, { years: 5 }),
    priceVixOnly_y10: trimRolling(tr1990, sPV, VARIANTS, { years: 10 }),
  };

  // 7. The greed alert ("stop deploying new money"): F&G 76+ within 3% of the high, off below 65.
  const gOpt = { maxDd: CONFIG.greedMaxDrawdown };
  const gHi = at(pOv, freq(ov.map((r) => r.fg), CONFIG.greedScore)), gReset = at(pOv, freq(ov.map((r) => r.fg), CONFIG.greedResetScore));
  const gReal = greedEpisodes(real, { ...gOpt, minScore: CONFIG.greedScore, reset: CONFIG.greedResetScore, warm: 0 });
  const gPx = greedEpisodes(px, { ...gOpt, minScore: gHi, reset: gReset });
  const fwdOf = (r, s) => { const f = trimForward(r, s); f.dates = f.dates.slice(-12); return f; };
  out.greed = {
    rule: { score: CONFIG.greedScore, maxDd: CONFIG.greedMaxDrawdown, reset: CONFIG.greedResetScore, proxyLevel: gHi, proxyReset: gReset },
    real_2020: { ...fwdOf(real, gReal.starts), daysOnPct: Math.round((gReal.on.filter(Boolean).length / real.filter((r) => r.fg != null).length) * 100) },
    proxy_1990: { ...fwdOf(px, gPx.starts), daysOnPct: Math.round((gPx.on.filter(Boolean).length / px.length) * 100) },
    // Monthly saver who holds new money in cash while the alert is on.
    pause_proxy_y10: pauseRolling(px, gPx.on, { years: 10 }),
    pause_proxy_y5: pauseRolling(px, gPx.on, { years: 5 }),
    pause_real_y3: pauseRolling(real, gReal.on, { years: 3, warm: real.findIndex((r) => r.fg != null) }),
  };
}
// 6. Trend only (no VIX before 1990), S&P price since 1950, as a long-sample check.
if (sp) {
  const p = sp.filter((r) => r.date >= "1950-01-03").map((r) => ({ date: r.date, close: r.close, vix: null }));
  out.trendOnly_1950_priceIndex = trimForward(p, trimEpisodes(p, { ...opt, useFg: false }));
  delete out.trendOnly_1950_priceIndex.dates;
}
console.log(JSON.stringify(out, null, 1));
