// Buffett lens (11 Nov 2026; Douglas: "lean into Warren Buffett's principles
// on picking companies"). Display only and paper only: nothing here changes
// the agreed long-term score or the pick rule.
//
// Buffett's tests, as he and his biographers describe them, made measurable
// with the four years of annual accounts Yahoo publishes (written down before
// any result was seen; research log 11 Nov):
//   1. Durable high returns (the "moat"): return on invested capital at least
//      15% on average and never below 10% (banks and insurers: return on
//      equity 12% average, 10% minimum). Owner's letters 1977 to 1987;
//      Frazzini, Kabiller and Pedersen, "Buffett's Alpha" (2018): his returns
//      are explained largely by buying quality.
//   2. Pricing power: gross margin 40%+ and steady (range 8 points or less);
//      where there is no gross profit line, operating margin 15%+ and steady.
//      Not applied to financials.
//   3. Steady earnings: a profit every year, earnings per share higher than
//      four years ago, at most one down year.
//   4. Little debt: long-term debt no more than 4 years of net income (not
//      applied to financials, which borrow by design).
//   5. Cash, not just accounting profit: owner earnings (net income plus
//      depreciation minus all capital spending, the cautious version of the
//      1986 letter) at least 80% of net income over the years. Not financials.
//   6. Shareholder-friendly: diluted shares no more than 2% above four years
//      ago (buybacks or at least no dilution).
//   Quality passes when every test that applies passes (at least 4 apply;
//   3 for financials, where tests 2, 4 and 5 do not apply).
//   7. Margin of safety: intrinsic value from owner earnings (net income for
//      financials), grown at the past EPS growth rate capped at 0% to 7% for
//      ten years, then 2.5% a year for ever, discounted at 10%. Done on the
//      earnings yield (1 / trailing P/E) so share prices in pence and accounts
//      in dollars cannot be mixed up. Buy zone: price at least 25% below it.
// REITs are not assessed (their earnings are distorted by depreciation;
// see the REIT view), nor investment trusts and holding companies.
import { r1, r2 } from "./util.js";
import { gicsSector } from "./sectorValue.js";

export const BUFFETT = { roic: 0.15, roicMin: 0.10, roe: 0.12, roeMin: 0.10, gm: 0.40, gmRange: 0.08, om: 0.15, debtYears: 4, oeShare: 0.8, dilution: 1.02,
  discount: 0.10, terminal: 0.025, gCap: 0.07, years: 10, mos: 0.25, minTests: 4, minTestsFin: 3 };

export const TS_TYPES = ["NetIncome", "TotalRevenue", "GrossProfit", "OperatingIncome", "EBIT", "StockholdersEquity", "LongTermDebt", "TotalDebt",
  "OperatingCashFlow", "CapitalExpenditure", "DepreciationAndAmortization", "DilutedAverageShares", "DilutedEPS", "InvestedCapital", "TaxRateForCalcs"];

// Yahoo fundamentals-timeseries JSON -> { years: [fiscal year ends], NetIncome: [..], ... } oldest first, null where missing.
export function parseTimeseries(j) {
  const res = j?.timeseries?.result ?? [];
  const byType = {}, dates = new Set();
  for (const r of res) {
    const t = r?.meta?.type?.[0];
    if (!t || !Array.isArray(r[t])) continue;
    const k = t.replace(/^annual/, "");
    byType[k] = new Map(r[t].filter(Boolean).map((x) => [x.asOfDate, x.reportedValue?.raw]));
    for (const x of r[t]) if (x?.asOfDate) dates.add(x.asOfDate);
  }
  const years = [...dates].sort().slice(-4);
  const out = { years };
  for (const k of TS_TYPES) out[k] = years.map((y) => { const v = byType[k]?.get(y); return Number.isFinite(v) ? v : null; });
  return out;
}

const avg = (xs) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);
const nums = (xs) => xs.filter((v) => Number.isFinite(v));
const pc = (x) => `${r1(x * 100)}%`;

export function kindOf(sector, industry = "") {
  const g = gicsSector(sector);
  if (g === "Real Estate" || /REIT/i.test(industry || "")) return "reit";
  if (g === "Financials") return "fin";
  return "co";
}

// The price-independent part, computed when the accounts are fetched.
// s: parseTimeseries() output. Returns { fy, n, kind, checks, quality, oeToNi, epsGrowth } or { kind, skip }.
export function buffettQuality(s, { sector, industry } = {}, b = BUFFETT) {
  const kind = kindOf(sector, industry);
  if (kind === "reit") return { kind, skip: "REIT: earnings distorted by depreciation (see the REIT view)" };
  const n = s?.years?.length ?? 0;
  if (n < 3) return { kind, skip: "fewer than 3 years of accounts" };
  const NI = s.NetIncome, checks = [];
  const add = (key, label, ok, value) => checks.push({ key, label, ok, value });
  // 1. Returns
  if (kind === "fin") {
    const roe = s.years.map((_, i) => (NI[i] != null && s.StockholdersEquity[i] > 0 ? NI[i] / s.StockholdersEquity[i] : null)).filter((v) => v != null);
    add("returns", "Return on equity 12%+ (never under 10%)", roe.length >= 3 ? avg(roe) >= b.roe && Math.min(...roe) >= b.roeMin : null, roe.length ? `${pc(avg(roe))} avg, ${pc(Math.min(...roe))} worst` : "n/a");
  } else {
    const roic = s.years.map((_, i) => {
      const e = s.EBIT[i] ?? s.OperatingIncome[i], ic = s.InvestedCapital[i], tax = Math.min(0.35, Math.max(0, s.TaxRateForCalcs[i] ?? 0.21));
      return e != null && ic > 0 ? (e * (1 - tax)) / ic : null;
    }).filter((v) => v != null);
    add("returns", "Return on capital 15%+ (never under 10%)", roic.length >= 3 ? avg(roic) >= b.roic && Math.min(...roic) >= b.roicMin : null, roic.length ? `${pc(avg(roic))} avg, ${pc(Math.min(...roic))} worst` : "n/a");
  }
  // 2. Pricing power
  if (kind !== "fin") {
    const gm = s.years.map((_, i) => (s.GrossProfit[i] != null && s.TotalRevenue[i] > 0 ? s.GrossProfit[i] / s.TotalRevenue[i] : null)).filter((v) => v != null);
    const om = s.years.map((_, i) => ((s.OperatingIncome[i] ?? s.EBIT[i]) != null && s.TotalRevenue[i] > 0 ? (s.OperatingIncome[i] ?? s.EBIT[i]) / s.TotalRevenue[i] : null)).filter((v) => v != null);
    if (gm.length >= 3) add("pricing", "Gross margin 40%+ and steady", avg(gm) >= b.gm && Math.max(...gm) - Math.min(...gm) <= b.gmRange, `${pc(avg(gm))} avg, range ${r1((Math.max(...gm) - Math.min(...gm)) * 100)} pts`);
    else if (om.length >= 3) add("pricing", "Operating margin 15%+ and steady", avg(om) >= b.om && Math.max(...om) - Math.min(...om) <= b.gmRange, `${pc(avg(om))} avg, range ${r1((Math.max(...om) - Math.min(...om)) * 100)} pts`);
    else add("pricing", "Gross margin 40%+ and steady", null, "n/a");
  }
  // 3. Steady earnings
  const eps = s.DilutedEPS, ni = nums(NI);
  if (ni.length >= 3) {
    const e = eps.filter((v) => v != null);
    const downs = e.slice(1).filter((v, i) => v < e[i]).length;
    const ok = ni.every((v) => v > 0) && e.length >= 3 && e.at(-1) >= e[0] && downs <= 1;
    add("earnings", "Profit every year, EPS up over the period", ok, e.length >= 2 ? `EPS ${r2(e[0])} to ${r2(e.at(-1))}${downs ? `, ${downs} down year${downs > 1 ? "s" : ""}` : ""}` : "n/a");
  } else add("earnings", "Profit every year, EPS up over the period", null, "n/a");
  // 4. Debt
  if (kind !== "fin") {
    const debt = s.LongTermDebt.at(-1) ?? s.TotalDebt.at(-1), last = NI.at(-1);
    add("debt", "Long-term debt under 4 years of profit", debt == null || last == null ? null : last > 0 ? debt / last <= b.debtYears : false, debt == null || last == null ? "n/a" : last > 0 ? `${r1(debt / last)} years` : "no profit");
  }
  // 5. Owner earnings
  let oeToNi = null;
  if (kind !== "fin") {
    const idx = s.years.map((_, i) => i).filter((i) => NI[i] != null && s.CapitalExpenditure[i] != null);
    const oe = idx.map((i) => NI[i] + (s.DepreciationAndAmortization[i] ?? 0) + s.CapitalExpenditure[i]);
    const niSum = idx.reduce((a, i) => a + NI[i], 0), oeSum = oe.reduce((a, v) => a + v, 0);
    oeToNi = idx.length >= 3 && niSum > 0 ? oeSum / niSum : null;
    add("cash", "Owner earnings 80%+ of profit", oeToNi == null ? null : oeToNi >= b.oeShare, oeToNi == null ? "n/a" : `${Math.round(oeToNi * 100)}%`);
  } else oeToNi = 1;
  // 6. Shares
  const sh = nums(s.DilutedAverageShares);
  add("shares", "No dilution (shares at most 2% up)", sh.length >= 3 ? sh.at(-1) <= sh[0] * b.dilution : null, sh.length >= 2 ? `${sh.at(-1) < sh[0] ? "" : "+"}${r1((sh.at(-1) / sh[0] - 1) * 100)}%` : "n/a");
  const applicable = checks.filter((c) => c.ok != null);
  const passed = applicable.filter((c) => c.ok).length;
  // EPS growth for the valuation, capped.
  const e = eps.filter((v) => v != null);
  const yrs = e.length - 1, epsGrowth = yrs >= 2 && e[0] > 0 && e.at(-1) > 0 ? Math.pow(e.at(-1) / e[0], 1 / yrs) - 1 : 0;
  return { kind, fy: s.years.at(-1), n, checks, passed, applicable: applicable.length, quality: applicable.length >= (kind === "fin" ? b.minTestsFin : b.minTests) && passed === applicable.length, minTests: kind === "fin" ? b.minTestsFin : b.minTests,
    oeToNi: oeToNi == null ? null : r2(oeToNi), epsGrowth: r2(Math.min(b.gCap, Math.max(0, epsGrowth)) * 100) / 100 };
}

// Value multiple: present value of 1 of owner earnings growing at g.
export function valueMultiple(g, b = BUFFETT) {
  let m = 0;
  for (let t = 1; t <= b.years; t++) m += Math.pow(1 + g, t) / Math.pow(1 + b.discount, t);
  return m + (Math.pow(1 + g, b.years) * (1 + b.terminal)) / ((b.discount - b.terminal) * Math.pow(1 + b.discount, b.years));
}

// Full lens with today's price via the trailing P/E.
export function buffettLens(q, pe, b = BUFFETT) {
  if (!q) return null;
  if (q.skip) return { verdict: "Not assessed", tone: "na", note: q.skip, checks: [] };
  let mos = null, ivRatio = null;
  if (Number.isFinite(pe) && pe > 0 && pe < 200 && q.oeToNi != null && q.oeToNi > 0) {
    ivRatio = (q.oeToNi / pe) * valueMultiple(q.epsGrowth, b);
    mos = 1 - 1 / ivRatio;
  }
  const checks = [...q.checks, { key: "mos", label: "Price 25%+ below intrinsic value", ok: mos == null ? null : mos >= b.mos, value: mos == null ? "n/a" : `${mos >= 0 ? "" : "−"}${Math.abs(Math.round(mos * 100))}% ${mos >= 0 ? "below" : "above"}` }];
  const fails = q.checks.filter((c) => c.ok === false).map((c) => c.label);
  const verdict = q.quality ? (mos != null && mos >= b.mos ? "Buffett buy zone" : "Wonderful, not cheap") : q.applicable < (q.minTests ?? 4) ? "Not enough data" : `Fails ${fails.length} test${fails.length === 1 ? "" : "s"}`;
  const tone = verdict === "Buffett buy zone" ? "good" : verdict === "Wonderful, not cheap" ? "watch" : "na";
  const note = `${verdict}: passes ${q.passed} of ${q.applicable} quality tests (${q.fy?.slice(0, 4)} accounts)${mos != null ? `; price ${mos >= 0 ? `${Math.round(mos * 100)}% below` : `${Math.round(-mos * 100)}% above`} a cautious intrinsic value (growth ${Math.round(q.epsGrowth * 100)}% a year for 10 years, then 2.5%, discounted at 10%)` : ""}.${fails.length && !q.quality ? ` Fails: ${fails.join("; ").toLowerCase()}.` : ""}`;
  return { verdict, tone, quality: q.quality, mos: mos == null ? null : r2(mos), ivRatio: ivRatio == null ? null : r2(ivRatio), passed: q.passed, applicable: q.applicable, fy: q.fy, kind: q.kind, checks, note };
}

// Rotating cache (data/buffett-sample.json): accounts change once a year, so
// each company is refreshed every MAX_AGE days, PER_NIGHT at a time.
export const B_MAX_AGE = 90, B_PER_NIGHT = 220;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
// priority: symbols (picks, bench) fetched first when due.
export function pickBuffett(symbols, cache, today, n = B_PER_NIGHT, priority = []) {
  const age = (s) => (cache[s]?.date ? days(cache[s].date, today) : Infinity), pr = new Set(priority);
  return symbols.filter((s) => age(s) >= B_MAX_AGE).sort((a, b) => (pr.has(b) ? 1 : 0) - (pr.has(a) ? 1 : 0) || age(b) - age(a) || a.localeCompare(b)).slice(0, n);
}
export const freshQ = (cache, s, today) => (cache[s]?.date && days(cache[s].date, today) <= B_MAX_AGE * 2 ? cache[s].q : null);
