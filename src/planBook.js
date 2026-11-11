// Plan book (paper), from Mon 16 Nov 2026. Douglas (11 Nov): "just track
// everything". The agreed plan (docs/STRATEGY-NOTES.md) run on a notional
// £10,000 so its value can be judged against simply holding VWRP, plus
// variants for the proposals still waiting on Douglas, so each proposal
// gathers evidence instead of waiting.
// Model of the agreed rules (written down before it first ran):
//   - Start: 60% into VWRP, 15% dip reserve in cash, 15% picks pot in cash,
//     10% short-term pot (since 11 Nov) following the real pot's own book
//     (src/shortPot.js, history/short-pot.json).
//   - Picks: each of the five may take a 1% tranche (of the book's value at
//     the time) once per calendar month, on a night its tranche check passes
//     (Good entry, no results within 7 days; read from the monitor's
//     data.json), up to 3% at cost. A pick worth more than 5% of the book is
//     trimmed back to 3%, the proceeds going to VWRP.
//   - Reserve: a third of the reserve's starting size goes into VWRP each
//     time a deeper buy tier is confirmed (state.json buyTier); from 7 Dec, on
//     the first session on or after each month's first Monday, a sixth of the
//     reserve cash drips into VWRP unless a tier was confirmed in the 30 days
//     before.
//   - Costs: VWRP none (Trading 212, GBP fund; spread left out); US picks
//     0.15% FX on each side, UK picks 0.5% stamp duty on buys. Cash earns 0%.
//     Dividends left out on both sides.
// Variants:
//   agreed   the rules above.
//   weakHold proposal of 10 Nov: no tranche while a pick shows "weak results
//            and a falling price" (resultsCheck.tone "watch").
//   reitValue proposal of 10 Nov: REITs (VICI) take their tranche on the REIT
//            view's cash-flow score instead of the P/E one (checks.reitOk,
//            from the monitor's tranche check); other picks as agreed.
//            Added 11 Nov, before the book starts.
//   vwrp     everything in VWRP on day one (the benchmark).
//   buffettPot, momentumPot (added 11 Nov): the plan with the 15% picks pot
//            following the Buffett book or the momentum books (average of
//            the S&P 500 and FTSE 100 books) instead of the five picks; cash
//            until that book starts. Same reserve rules as the plan.
import { r2 } from "./util.js";

export const PBOOK = { start: "2026-11-16", equity0: 10000, core: 0.60, reserve: 0.15, picks: 0.15, short: 0.10, tranche: 0.01, maxCost: 0.03, trimAbove: 0.05, trimTo: 0.03, dripFrom: "2026-12-07", dripShare: 1 / 6 };
export const VARIANTS = [
  { key: "agreed", label: "The plan as agreed" },
  { key: "weakHold", label: "Plus: hold a tranche after weak results and a fall (proposal, 10 Nov)" },
  { key: "reitValue", label: "Plus: REITs valued on cash flow, not P/E (proposal, 10 Nov)" },
  { key: "vwrp", label: "Everything in VWRP" },
  { key: "buffettPot", label: "The plan, picks pot in the Buffett book" },
  { key: "momentumPot", label: "The plan, picks pot in the momentum books" },
];
const POTS = { buffettPot: "buffett", momentumPot: "momentum" };
const BUY_FEE = { US: 0.0015, UK: 0.005, EU: 0.0015 }, SELL_FEE = { US: 0.0015, UK: 0, EU: 0.0015 };

export function newPlanVariant(key, o = PBOOK) {
  const all = key === "vwrp";
  return { key, core: 0, coreLast: null, reserve: all ? 0 : o.equity0 * o.reserve, reserve0: all ? 0 : o.equity0 * o.reserve, picksCash: all ? 0 : o.equity0 * o.picks,
    shortPot: all ? 0 : o.equity0 * (o.short ?? 0), shortLast: null,
    pending: all ? o.equity0 : o.equity0 * o.core, picks: {}, potLast: null, lastTier: 0, lastTierDate: null, lastDrip: null, log: [], curve: [], value: o.equity0, started: null };
}
export const newPlanBook = () => ({ rules: PBOOK, variants: Object.fromEntries(VARIANTS.map((v) => [v.key, newPlanVariant(v.key)])) });

const firstMonday = (ym) => { for (let d = 1; d <= 7; d++) { const s = `${ym}-0${d}`; if (new Date(s + "T12:00:00Z").getUTCDay() === 1) return s; } return `${ym}-01`; };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export const pickValue = (p) => p.value;
export const variantValue = (v) => r2(v.core + v.reserve + v.picksCash + (v.shortPot ?? 0) + v.pending + Object.values(v.picks).reduce((a, p) => a + p.value, 0));

// One night. ctx: { date, vwrp (close), prices: {symbol: {close, market}}, checks: {symbol: {ok, tone, ticker}}, tier (deepest confirmed buy tier, e.g. -10 or 0) }.
export function stepVariant(v0, ctx, o = PBOOK) {
  const v = structuredClone(v0), { date, vwrp } = ctx;
  if (date < o.start || !(vwrp > 0)) return v;
  const log = (what) => v.log.push({ date, what });
  // Mark to tonight's prices first.
  if (v.coreLast > 0) v.core *= vwrp / v.coreLast;
  v.coreLast = vwrp;
  for (const [s, p] of Object.entries(v.picks)) { const c = ctx.prices[s]?.close; if (c > 0 && p.last > 0) { p.value *= c / p.last; p.last = c; } }
  // Day one: the core purchase.
  if (v.pending > 0) { v.core += v.pending; log(`Bought VWRP with ${Math.round((v.pending / o.equity0) * 100)}% of the book`); v.pending = 0; v.started = date; }
  if (v.key !== "vwrp") {
    const book = variantValue(v);
    // Reserve: a deeper confirmed tier deploys a third of its starting size.
    const tier = ctx.tier ?? 0;
    if (tier < v.lastTier || (tier < 0 && v.lastTier === 0)) {
      const amt = Math.min(v.reserve, v.reserve0 / 3);
      if (amt > 0) { v.reserve -= amt; v.core += amt; log(`Buy tier ${tier}%: a third of the reserve into VWRP`); }
      v.lastTier = tier; v.lastTierDate = date;
    } else if (tier === 0) v.lastTier = 0;
    // Drip: first session on or after the month's first Monday, from dripFrom.
    const ym = date.slice(0, 7), fm = firstMonday(ym);
    if (date >= o.dripFrom && date >= fm && v.lastDrip !== ym) {
      v.lastDrip = ym;
      const quiet = !v.lastTierDate || daysBetween(v.lastTierDate, date) > 30;
      if (quiet && v.reserve > 0) { const amt = v.reserve * o.dripShare; v.reserve -= amt; v.core += amt; log("Reserve drip: a sixth into VWRP"); }
      else if (!quiet) log("Reserve drip skipped: a buy tier in the last 30 days");
    }
    // Short-term pot (real money since 11 Nov): follows the pot's own book
    // (ctx.pots.short: value / start); cash until its first trade.
    { const idx = ctx.pots?.short; if (idx > 0 && v.shortPot > 0) { if (v.shortLast > 0) v.shortPot *= idx / v.shortLast; v.shortLast = idx; } }
    // Pot variants: the picks pot follows another paper book (ctx.pots: value / start, or null before it starts).
    if (POTS[v.key]) {
      const idx = ctx.pots?.[POTS[v.key]];
      if (idx > 0) { if (v.potLast > 0) v.picksCash *= idx / v.potLast; else log(`Picks pot now follows the ${POTS[v.key]} book`); v.potLast = idx; }
    } else {
    // Picks: trim above 5%, then monthly tranches.
    for (const [s, p] of Object.entries(v.picks)) {
      if (p.value > book * o.trimAbove) {
        const cut = p.value - book * o.trimTo, fee = cut * (SELL_FEE[p.market] ?? 0);
        p.value -= cut; p.cost *= p.value / (p.value + cut); v.core += cut - fee; log(`Trimmed ${p.ticker} back to 3%`);
      }
    }
    for (const [s, ch] of Object.entries(ctx.checks ?? {})) {
      const px = ctx.prices[s];
      const ok = v.key === "reitValue" && ch?.reitOk != null ? ch.reitOk : ch?.ok;
      if (!ok || !(px?.close > 0)) continue;
      if (v.key === "weakHold" && ch.tone === "watch") continue;
      const p = v.picks[s] ?? { ticker: ch.ticker ?? s, market: px.market, value: 0, cost: 0, last: px.close, lastTranche: null, tranches: 0 };
      if (p.lastTranche === ym || p.cost >= book * o.maxCost - 1) continue;
      const amt = Math.min(book * o.tranche, book * o.maxCost - p.cost, v.picksCash);
      if (amt < book * o.tranche * 0.5) continue;
      const fee = amt * (BUY_FEE[px.market] ?? 0.0015);
      v.picksCash -= amt; p.value += amt - fee; p.cost += amt; p.last = px.close; p.lastTranche = ym; p.tranches++;
      v.picks[s] = p; log(`Tranche of ${p.ticker} (1% of the book)`);
    }
    }
  }
  v.value = variantValue(v);
  v.curve = [...v.curve.filter((x) => x.date !== date), { date, value: r2(v.value) }].slice(-1000);
  v.log = v.log.slice(-60);
  v.picks = Object.fromEntries(Object.entries(v.picks).map(([s, p]) => [s, { ...p, value: r2(p.value), cost: r2(p.cost) }]));
  for (const k of ["core", "reserve", "picksCash", "shortPot"]) v[k] = r2(v[k] ?? 0);
  return v;
}

export function stepPlanBook(b, ctx) {
  // Before the book starts, rebuild it from the current rules (they changed on
  // 11 Nov: the short-term pot); variants added later join the same way, so
  // nothing is ever backfilled.
  if (!Object.values(b.variants ?? {}).some((v) => v.started)) b = newPlanBook();
  const vs = { ...b.variants };
  for (const x of VARIANTS) if (!vs[x.key] && !Object.values(vs).some((v) => v.started)) vs[x.key] = newPlanVariant(x.key, b.rules);
  return { ...b, variants: Object.fromEntries(Object.entries(vs).map(([k, v]) => [k, stepVariant(v, ctx, b.rules)])) };
}

// Summary rows: value, return, and the gap to the VWRP variant.
export function planSummary(b) {
  const base = b.variants.vwrp;
  return VARIANTS.filter((x) => b.variants[x.key]).map((x) => {
    const v = b.variants[x.key], ret = v.started ? r2((v.value / b.rules.equity0 - 1) * 100) : null;
    return { key: x.key, label: x.label, started: v.started, value: v.value, returnPct: ret, vsVwrp: ret != null && base.started ? r2(ret - (base.value / b.rules.equity0 - 1) * 100) : null,
      mix: { core: v.core, reserve: v.reserve, picksCash: v.picksCash, shortPot: v.shortPot ?? 0, picks: Object.values(v.picks).map((p) => ({ ticker: p.ticker, value: p.value, cost: p.cost, tranches: p.tranches })) }, log: v.log.slice(-6).reverse() };
  });
}
