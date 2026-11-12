// Stock research scoring. Two lenses:
//   Long-term (hold for years): Quality, Value, Entry, Analyst sentiment.
//   Swing (days to weeks): a set of technical signals on daily bars.
// Every score comes with plain-English reasons so the number means something.
import { sma, rsi, macd, bollinger, atr, crossed, changeOver, rebase } from "./indicators.js";
import { interp, mean, pct, r1, r2, clamp } from "./util.js";
import { CYCLICAL_VALUE_CAP } from "./sectorValue.js";

const FIN_SECTORS = ["Financial Services", "Financials"];

// --- Technicals ------------------------------------------------------------
// One-year price change. A Yahoo "1y" download holds about 250 US sessions
// (holidays), fewer than the 253 a fixed 252-bar lookback needs, so every US
// stock in the scan had no 1-year return (found 5 Nov 2026). Fall back to the
// first bar when the data spans a year or so.
export function yearChange(rows) {
  const c = rows.map((r) => r.close);
  const exact = changeOver(c, 252);
  if (exact != null) return exact;
  const span = (Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / 86400000;
  return span >= 355 ? pct(c[c.length - 1], c[0]) : null;
}

// 12-1 month momentum: the return from a year ago to a month ago (21
// sessions), skipping the latest month. A "1y" download often holds 251 US
// sessions, so like yearChange() it falls back to the first bar when the data
// spans a year.
export function momentum12_1(rows) {
  const c = rows.map((r) => r.close), n = c.length - 1;
  if (n < 230) return null;
  if (n >= 252) return pct(c[n - 21], c[n - 252]);
  const span = (Date.parse(rows[n].date) - Date.parse(rows[0].date)) / 86400000;
  return span >= 355 ? pct(c[n - 21], c[0]) : null;
}

export function technicals(rows) {
  if (!rows || rows.length < 60) return null;
  const c = rows.map((r) => r.close), v = rows.map((r) => r.volume || 0);
  const n = c.length - 1, last = c[n];
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200);
  const rs = rsi(c, 14), m = macd(c), bb = bollinger(c, 20, 2), at = atr(rows, 14), vAvg = sma(v, 20);
  const win = rows.slice(-252);
  const high52 = Math.max(...win.map((r) => r.high ?? r.close)), low52 = Math.min(...win.map((r) => r.low ?? r.close));
  const priorHigh = Math.max(...rows.slice(-253, -1).map((r) => r.close));
  // Daily close-to-close volatility (standard deviation of log returns, %):
  // last 21 sessions vs the past year. A collapse to a fraction of normal
  // usually means the price is pinned by a takeover offer (DCC, Intertek and
  // Bio-Techne in Oct 2026), where ATR stops and swing signals mean nothing.
  const vol21 = dailyVol(c.slice(-22)), vol252 = dailyVol(c.slice(-253));
  const pinned = vol21 != null && vol252 != null && vol21 < 0.5 && vol21 < vol252 * 0.3;
  return {
    last, date: rows[n].date,
    sma20: s20[n], sma50: s50[n], sma200: s200[n],
    vs50: s50[n] ? pct(last, s50[n]) : null,
    vs200: s200[n] ? pct(last, s200[n]) : null,
    rsi: rs[n], rsiPrev: rs[n - 1],
    macdHist: m.hist[n], macdHistPrev: m.hist[n - 1],
    macdCrossUp: crossed(m.line, m.signal, 3, "up"), macdCrossDown: crossed(m.line, m.signal, 3, "down"),
    goldenCross: crossed(s50, s200, 10, "up"), deathCross: crossed(s50, s200, 10, "down"),
    pctB: bb[n]?.pctB ?? null,
    atrPct: at[n] ? (at[n] / last) * 100 : null, atr: at[n],
    volRatio: vAvg[n - 1] ? v[n] / vAvg[n - 1] : null,
    mom12_1: momentum12_1(rows),
    dayPct: changeOver(c, 1), weekPct: changeOver(c, 5), monthPct: changeOver(c, 21), m3Pct: changeOver(c, 63), y1Pct: yearChange(rows),
    high52, low52, offHigh: pct(last, high52), rangePos: high52 > low52 ? (last - low52) / (high52 - low52) : null,
    breakout: last >= priorHigh * 0.995 && rows.length > 200,
    vol21, vol252, pinned,
    series: rebase(c, 120),
  };
}

// Standard deviation of daily log returns, in percent.
export function dailyVol(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 10) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)) * 100;
}

// --- Swing signals ---------------------------------------------------------
// Each signal: { key, label, tone: "bull"|"bear", weight, why }.
export function swingSignals(t) {
  if (!t) return [];
  const s = [];
  if (t.pinned) return [{ key: "pinned", label: "Price pinned", tone: "bear", weight: -30,
    why: `Daily moves have shrunk to ${t.vol21.toFixed(2)}% from a usual ${t.vol252.toFixed(1)}%: usually a takeover offer or pending deal. Technical signals and ATR stops don't work here.` }];
  const up = t.sma50 && t.sma200 && t.last > t.sma50 && t.sma50 > t.sma200;
  const down = t.sma50 && t.sma200 && t.last < t.sma50 && t.sma50 < t.sma200;
  if (up) s.push({ key: "uptrend", label: "Uptrend", tone: "bull", weight: 10, why: "Price above the 50-day, 50-day above the 200-day." });
  if (down) s.push({ key: "downtrend", label: "Downtrend", tone: "bear", weight: -12, why: "Price below the 50-day, 50-day below the 200-day." });
  if (t.goldenCross) s.push({ key: "golden", label: "Golden cross", tone: "bull", weight: 10, why: "50-day crossed above the 200-day in the last two weeks." });
  if (t.deathCross) s.push({ key: "death", label: "Death cross", tone: "bear", weight: -10, why: "50-day crossed below the 200-day in the last two weeks." });
  if (t.rsi != null) {
    if (t.rsi < 30 && up) s.push({ key: "oversold-up", label: "Oversold in uptrend", tone: "bull", weight: 18, why: `RSI ${t.rsi.toFixed(0)}: a sharp pullback inside a rising trend, a classic swing entry.` });
    else if (t.rsi < 30) s.push({ key: "oversold", label: "Oversold", tone: "bull", weight: 8, why: `RSI ${t.rsi.toFixed(0)}: stretched to the downside; bounces are common but the trend isn't helping.` });
    else if (t.rsi > 75) s.push({ key: "overbought", label: "Overbought", tone: "bear", weight: -12, why: `RSI ${t.rsi.toFixed(0)}: stretched to the upside; poor risk/reward for a new entry.` });
    else if (t.rsi > 70) s.push({ key: "hot", label: "Running hot", tone: "bear", weight: -6, why: `RSI ${t.rsi.toFixed(0)}: momentum strong but extended.` });
    if (t.rsiPrev != null && t.rsiPrev < 30 && t.rsi >= 30) s.push({ key: "rsi-turn", label: "RSI turning up", tone: "bull", weight: 8, why: "RSI just climbed back above 30." });
  }
  if (t.macdCrossUp) s.push({ key: "macd-up", label: "MACD bullish cross", tone: "bull", weight: 8, why: "MACD crossed above its signal line in the last 3 sessions: momentum turning up." });
  if (t.macdCrossDown) s.push({ key: "macd-down", label: "MACD bearish cross", tone: "bear", weight: -8, why: "MACD crossed below its signal line in the last 3 sessions: momentum turning down." });
  if (t.pctB != null && t.pctB < 0) s.push({ key: "bb-low", label: "Below lower Bollinger", tone: "bull", weight: 6, why: "Closed below the lower Bollinger band: unusually far below its 20-day average." });
  if (t.pctB != null && t.pctB > 1) s.push({ key: "bb-high", label: "Above upper Bollinger", tone: "bear", weight: -6, why: "Closed above the upper Bollinger band: unusually far above its 20-day average." });
  if (up && t.vs50 != null && Math.abs(t.vs50) <= 2 && (t.rsi ?? 50) < 60) s.push({ key: "pullback-50", label: "Pullback to 50-day", tone: "bull", weight: 10, why: "Resting on its 50-day average inside an uptrend, a common support level." });
  if (t.breakout) s.push({ key: "breakout", label: "52-week high breakout", tone: "bull", weight: 8, why: "At or near a new 52-week high: momentum names often keep running." });
  if (t.volRatio != null && t.volRatio >= 1.8 && t.dayPct > 0) s.push({ key: "accumulation", label: "High-volume up day", tone: "bull", weight: 6, why: `Volume ${t.volRatio.toFixed(1)}× normal on an up day: buyers stepping in.` });
  if (t.volRatio != null && t.volRatio >= 1.8 && t.dayPct < 0) s.push({ key: "distribution", label: "High-volume down day", tone: "bear", weight: -6, why: `Volume ${t.volRatio.toFixed(1)}× normal on a down day: sellers in control.` });
  return s;
}

export function swingVerdict(t, signals, earningsDays) {
  if (!t) return null;
  const score = clamp(Math.round(50 + signals.reduce((a, x) => a + x.weight, 0)), 0, 100);
  let verdict = score >= 65 ? "Setup" : score <= 35 ? "Avoid" : "Neutral";
  const notes = [];
  if (earningsDays != null && earningsDays >= 0 && earningsDays <= 7) {
    notes.push(`Earnings ${earningsDays === 0 ? "today" : earningsDays === 1 ? "tomorrow" : `in ${earningsDays} days`}: price can gap either way. Size down or wait.`);
    if (verdict === "Setup") verdict = "Setup (earnings risk)";
  }
  if (t.pinned) { verdict = "Avoid"; notes.push("Price pinned (likely a takeover offer): not a swing candidate."); }
  // Stop: 2x ATR, but never tighter than 2x the stock's normal (one-year)
  // daily move, so a quiet spell can't produce a stop a normal day would hit.
  const dist = t.atr ? Math.max(2 * t.atr, t.vol252 != null ? 2 * (t.vol252 / 100) * t.last : 0) : null;
  const stop = dist ? r2(t.last - dist) : null;
  return { score, verdict, stop, stopPct: stop ? r1(pct(stop, t.last)) : null, atrPct: r1(t.atrPct), pinned: !!t.pinned, notes };
}

// Weekday sessions between two YYYY-MM-DD dates (a's bar is this many sessions
// behind b's). Holidays count as sessions, which only makes the check gentler.
export function sessionsBehind(a, b) {
  if (!a || !b || a >= b) return 0;
  let n = 0;
  for (let d = new Date(a + "T12:00:00Z"); d.toISOString().slice(0, 10) < b; d.setUTCDate(d.getUTCDate() + 1)) {
    const next = new Date(d.getTime() + 86400000).getUTCDay();
    if (next !== 0 && next !== 6) n++;
  }
  return n;
}
// A stock whose last daily bar is this many sessions behind its market has
// stopped trading (delisted, suspended, taken over): Kenvue, 30 Oct 2026.
export const STALE_SESSIONS = 3;

// --- Long-term score -------------------------------------------------------
const P = {
  forwardPE: [[8, 100], [12, 88], [16, 72], [20, 58], [25, 45], [35, 25], [50, 8], [70, 0]],
  trailingPE: [[8, 100], [12, 85], [16, 70], [20, 56], [28, 40], [40, 20], [60, 5], [90, 0]],
  peg: [[0.5, 100], [1, 85], [1.5, 65], [2, 45], [3, 15], [4, 0]],
  evToEbitda: [[6, 100], [10, 80], [15, 60], [22, 38], [30, 18], [45, 0]],
  profitMargin: [[-0.1, 0], [0, 20], [0.05, 40], [0.12, 65], [0.2, 85], [0.3, 100]],
  roe: [[-0.05, 0], [0, 20], [0.08, 45], [0.15, 70], [0.25, 90], [0.4, 100]],
  revenueGrowth: [[-0.1, 0], [0, 30], [0.05, 50], [0.1, 68], [0.2, 88], [0.35, 100]],
  earningsGrowth: [[-0.2, 0], [0, 30], [0.08, 55], [0.15, 72], [0.3, 92], [0.5, 100]],
  debtToEquity: [[0, 100], [30, 90], [80, 65], [150, 35], [250, 10], [400, 0]],
  offHigh: [[-45, 65], [-30, 95], [-20, 90], [-12, 70], [-6, 45], [0, 20]],
  vs200: [[-30, 45], [-15, 70], [-5, 85], [0, 75], [8, 50], [20, 25], [40, 5]],
  // Entry rule live since 10 Nov (research log 4 and 5 Nov; agreed by Douglas):
  // no extra credit for a discount beyond 3%, flat to -20% and beyond.
  offHighAlt: [[-20, 70], [-3, 70], [0, 62]],
  // 12-1 month momentum, %: the strongest fifth did best in our test.
  mom: [[-30, 15], [-10, 35], [0, 45], [10, 58], [25, 78], [50, 95]],
  rsi: [[25, 95], [35, 85], [45, 70], [55, 55], [65, 40], [75, 20], [85, 5]],
  // Multiple / sector median (display-only peer view, src/sectorValue.js).
  // At the median it scores 58, as a P/E of 20 does on the fixed bands.
  rel: [[0.4, 100], [0.6, 88], [0.8, 72], [1, 58], [1.25, 45], [1.75, 25], [2.5, 8], [3.5, 0]],
  upside: [[-15, 0], [0, 30], [10, 55], [20, 75], [35, 95], [50, 100]],
  rec: [[1.2, 90], [1.8, 70], [2.3, 50], [2.8, 32], [3.3, 15], [4, 0]],
};

// Investment trusts (closed-end funds) report portfolio gains as earnings, so
// P/E, margins and ROE describe last year's market, not a business: PCT showed
// a P/E of 1.8 and topped the scan on 3 Nov 2026. They are not scored.
export const isInvestmentTrust = (f) => !!(f?.closedEnd || /closed end/i.test(f?.sector || "") || /investment trust (plc|ltd|limited)\b/i.test(f?.name || ""));

// Companies that are mostly a pile of one asset (Strategy holds bitcoin): their
// earnings swing with the asset's price, so P/E and margins say little about a
// business (Strategy showed a P/E of 7.3 on 9 Nov 2026). Matched by name, as
// the scan's quick data has no symbol. Not scored, like investment trusts.
const ASSET_HOLDERS = [{ re: /^(Strategy Inc|MicroStrategy)\b/i, asset: "bitcoin" }];
export const assetHolding = (f) => ASSET_HOLDERS.find((h) => h.re.test(f?.name || ""))?.asset ?? null;
// Either kind of non-operating business: excluded from scores and peer medians.
export const notScored = (f) => isInvestmentTrust(f) || !!assetHolding(f);

const metric = (key, label, value, display, why) => ({ key, label, value, display, score: value == null ? null : Math.round(interp(value, P[key])), why });
// Peer-relative version: scored on the multiple divided by its sector median.
const relMetric = (key, label, value, med, display, why) => (med > 0 && value != null
  ? { key, label, value, display: `${display} (sector ${med.toFixed(1)})`, score: Math.round(interp(value / med, P.rel)), why: `${why} Scored against the sector median.` }
  : metric(key, label, value, display, why));

// Live scoring since 10 Nov 2026 is longTermLive() below: value against sector
// peers (with the cyclical cap) and the new Entry rule with momentum. Called
// bare, longTerm(f, t) is the rule before 10 Nov, kept for the "old rule" note.
// peer: sector medians and a cyclical flag from src/sectorValue.js.
// opts.entryAlt: score Entry under the 10 Nov rule.
export function longTerm(f, t, peer = null, { entryAlt = false } = {}) {
  const fin = FIN_SECTORS.includes(f?.sector);
  const fx = (n, d = 1) => (n == null ? "n/a" : n.toFixed(d));
  const pc = (n) => (n == null ? "n/a" : `${(n * 100).toFixed(1)}%`);

  const quality = [
    metric("profitMargin", "Net margin", f?.profitMargin, pc(f?.profitMargin), "How much of each pound of sales becomes profit."),
    metric("roe", "Return on equity", f?.roe, pc(f?.roe), "Profit generated on shareholders' money."),
    metric("revenueGrowth", "Revenue growth", f?.revenueGrowth, pc(f?.revenueGrowth), "Year-on-year sales growth (latest quarter)."),
    metric("earningsGrowth", "Earnings growth", f?.earningsGrowth, pc(f?.earningsGrowth), "Year-on-year earnings growth (latest quarter)."),
    fin ? null : metric("debtToEquity", "Debt / equity", f?.debtToEquity, f?.debtToEquity == null ? "n/a" : `${(f.debtToEquity / 100).toFixed(2)}×`, "Lower means less reliance on borrowing."),
  ].filter(Boolean);

  const upside = f?.targetMean && t?.last ? pct(f.targetMean, t.last) : null;
  const m = (key, label, value, display, why) => (peer ? relMetric(key, label, value, peer[key], display, why) : metric(key, label, value, display, why));
  const value = [
    m("forwardPE", "Forward P/E", f?.forwardPE > 0 ? f.forwardPE : null, fx(f?.forwardPE), "Price vs next year's expected earnings. Lower is cheaper."),
    m("trailingPE", "Trailing P/E", f?.trailingPE > 0 ? f.trailingPE : null, fx(f?.trailingPE), "Price vs the last 12 months' earnings."),
    metric("peg", "PEG", f?.peg > 0 ? f.peg : null, fx(f?.peg, 2), "P/E divided by growth. Around 1 or below is good value for the growth."),
    fin ? null : m("evToEbitda", "EV / EBITDA", f?.evToEbitda > 0 ? f.evToEbitda : null, fx(f?.evToEbitda), "Whole-company value vs operating earnings."),
  ].filter(Boolean);

  const offHighItem = metric("offHigh", "Off 52-week high", t?.offHigh, t?.offHigh == null ? "n/a" : `${t.offHigh.toFixed(1)}%`, "A discount to the recent high improves the entry, within reason.");
  if (entryAlt && t?.offHigh != null) { offHighItem.score = Math.round(interp(t.offHigh, P.offHighAlt)); offHighItem.why = "Just below the high scores a little better than at it; a deeper fall earns no extra credit (our ten-year test found none)."; }
  const entry = [
    offHighItem,
    entryAlt && t?.mom12_1 != null ? metric("mom", "Momentum (12-1 months)", t.mom12_1, `${t.mom12_1 >= 0 ? "+" : ""}${t.mom12_1.toFixed(1)}%`, "Return from a year ago to a month ago. Strong past winners have tended to keep doing well.") : null,
    metric("vs200", "vs 200-day", t?.vs200, t?.vs200 == null ? "n/a" : `${t.vs200 >= 0 ? "+" : ""}${t.vs200.toFixed(1)}%`, "Close to or modestly below the long-term average is a calmer entry than far above it."),
    metric("rsi", "RSI (14)", t?.rsi, fx(t?.rsi, 0), "Below ~40 is a cooled-off entry; above ~70 is stretched."),
  ].filter(Boolean);

  const sentiment = [
    metric("upside", "Upside to target", upside, upside == null ? "n/a" : `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%`, `Analysts' average price target${f?.analysts ? ` (${f.analysts} analysts)` : ""}.`),
    metric("rec", "Analyst rating", f?.recommendationMean, f?.recommendationMean == null ? "n/a" : `${f.recommendationMean.toFixed(1)} (${(f.recommendationKey || "").replace("_", " ")})`, "1 = strong buy, 3 = hold, 5 = sell."),
  ];

  const pillar = (key, label, weight, items) => ({ key, label, weight, items, score: mean(items.map((i) => i.score)) == null ? null : Math.round(mean(items.map((i) => i.score))) });
  const valuePillar = pillar("value", "Value", 0.32, value);
  if (peer?.cyclical && valuePillar.score > CYCLICAL_VALUE_CAP) { valuePillar.score = CYCLICAL_VALUE_CAP; valuePillar.capped = true; }
  const pillars = [
    pillar("quality", "Quality", 0.32, quality),
    valuePillar,
    pillar("entry", "Entry", 0.26, entry),
    pillar("sentiment", "Analysts", 0.1, sentiment),
  ];
  const avail = pillars.filter((p) => p.score != null);
  const wsum = avail.reduce((a, p) => a + p.weight, 0);
  const score = wsum ? Math.round(avail.reduce((a, p) => a + p.score * p.weight, 0) / wsum) : null;
  const get = (k) => pillars.find((p) => p.key === k)?.score;
  const coverage = Math.round((pillars.flatMap((p) => p.items).filter((i) => i.score != null).length / pillars.flatMap((p) => p.items).length) * 100);

  // Still falling? Quality at a discount is fine to buy, but in stages.
  const falling = !!(t?.sma50 && t?.sma200 && t.last < t.sma50 && t.sma50 < t.sma200);
  let verdict = "Wait", note = null;
  if (score == null) verdict = "No data";
  else if ((get("value") ?? 50) < 35) verdict = "Expensive";
  else if ((get("entry") ?? 50) < 35 && (t?.rsi ?? 50) > 68) { verdict = "Stretched"; note = "Fundamentals may be fine, but the price has run hot. Wait for a pullback."; }
  else if (score >= GOOD.score && (get("entry") ?? 0) >= GOOD.entry && (get("quality") ?? 50) >= GOOD.quality && (get("value") ?? 50) >= GOOD.value) {
    verdict = falling ? "Fair" : "Good entry";
    if (falling) note = "Quality at a discount, but the trend is still down. Buy in stages rather than all at once.";
  }
  else if (score >= 55) verdict = "Fair";
  if (t?.pinned && score != null) { verdict = "Wait"; note = "Price pinned, most likely by a takeover offer: the upside is probably capped at the offer price."; }
  const held = assetHolding(f);
  if (held) {
    return { score: null, verdict: "Holding company", note: `Mostly a ${held} holding, not an operating business: its profits rise and fall with the ${held} price, so P/E and margins say little. Judge it as a leveraged bet on ${held}, so it is not scored.`, falling,
      pillars: pillars.map((p) => ({ ...p, score: null, items: p.items.map((i) => ({ ...i, score: null })) })), coverage, financials: fin, trust: true, holding: held };
  }
  if (isInvestmentTrust(f)) {
    return { score: null, verdict: "Investment trust", note: "A fund, not a company: its P/E and margins reflect portfolio gains. Judge it on the discount to net asset value, costs and the holdings, so it is not scored.", falling,
      // Keep the raw figures for reference, but no pillar scores: they would read as strengths.
      pillars: pillars.map((p) => ({ ...p, score: null, items: p.items.map((i) => ({ ...i, score: null })) })), coverage, financials: fin, trust: true };
  }

  const short = verdict !== "Good entry" && score != null;
  const gaps = short ? goodEntryGaps(score, get, falling, !!t?.pinned) : [];
  const near = short && ["Fair", "Wait"].includes(verdict) && nearGood(score, get, falling, !!t?.pinned);
  return { score, verdict, note, falling, pillars, coverage, financials: fin, gaps, near };
}

// The bar for "Good entry" (all must hold, and the trend must not be down).
export const GOOD = { score: 72, entry: 70, quality: 55, value: 45 };

// What keeps a stock short of "Good entry", in plain words, e.g.
// ["Entry 69, needs 70"]. Missing pillars are treated as the verdict does.
function gapList(score, get, falling, pinned) {
  const out = [];
  if (pinned) out.push({ text: "price pinned by a likely takeover", short: Infinity });
  if (score < GOOD.score) out.push({ text: `score ${score}, needs ${GOOD.score}`, short: GOOD.score - score });
  const e = get("entry"), q = get("quality"), v = get("value");
  if ((e ?? 0) < GOOD.entry) out.push(e == null ? { text: "no Entry data", short: Infinity } : { text: `Entry ${e}, needs ${GOOD.entry}`, short: GOOD.entry - e });
  if (q != null && q < GOOD.quality) out.push({ text: `Quality ${q}, needs ${GOOD.quality}`, short: GOOD.quality - q });
  if (v != null && v < GOOD.value) out.push({ text: `Value ${v}, needs ${GOOD.value}`, short: GOOD.value - v });
  if (falling) out.push({ text: out.length ? "trend still down" : "trend still down (below the 50-day, which is below the 200-day)", short: Infinity });
  return out;
}
export const goodEntryGaps = (score, get, falling = false, pinned = false) => gapList(score, get, falling, pinned).map((g) => g.text);

// Near a good entry: one bar missed, by 3 points or less, trend not down.
export const NEAR_POINTS = 3;
export function nearGood(score, get, falling = false, pinned = false) {
  const g = gapList(score, get, falling, pinned);
  return g.length === 1 && g[0].short <= NEAR_POINTS;
}

// A verdict that flickers across a threshold (Meta at Entry 69/70) should not
// alert or log a track-record event every time it comes back: a new signal
// counts only if the stock was not in that state within the last `quiet` days.
// lastSeen: the last date it was in the state (YYYY-MM-DD) or null.
export const SIGNAL_QUIET_DAYS = 10;
export function freshSignal(isOn, wasOn, lastSeen, today, quiet = SIGNAL_QUIET_DAYS) {
  if (!isOn || wasOn) return false;
  if (!lastSeen || !today) return true;
  return (Date.parse(today) - Date.parse(lastSeen)) / 86400000 > quiet;
}

// The live long-term score (agreed by Douglas 10 Nov 2026).
export const SCORING_VERSION = "2026-11-12"; // 12 Nov: REITs on cash flow (longTermScored); 11 Nov: EV/EBITDA against sector peers (src/evSample.js withEv)
export const longTermLive = (f, t, peer = null) => longTerm(f, t, peer, { entryAlt: true });

// REITs score on cash flow (decided 12 Nov 2026, STRATEGY-NOTES): property
// depreciation cuts reported earnings, so P/E overstates a REIT's price. The
// Value pillar judges price / operating cash flow against the median of fully
// scored REITs in place of P/E (both P/E slots), and drops PEG (P/E-based, so
// distorted the same way). rv: reitView() output (src/sectorValue.js).
function reitInputs(f, peer, rv) {
  if (!peer || !(rv?.pocf > 0) || !(rv?.median > 0)) return null;
  return { f: { ...f, forwardPE: rv.pocf, trailingPE: rv.pocf, peg: null }, peer: { ...peer, pe: rv.median, forwardPE: rv.median, trailingPE: rv.median } };
}

// The live score for any stock: longTermLive(), or for a REIT with a cash-flow
// view, the same score with Value on price / operating cash flow. The Value
// items are relabelled so the page says what was measured.
export function longTermScored(f, t, peer, rv = null) {
  const r = reitInputs(f, peer, rv);
  if (!r) return longTermLive(f, t, peer);
  const lt = longTermLive(r.f, t, r.peer);
  if (lt.score == null) return longTermLive(f, t, peer);
  const vp = lt.pillars.find((p) => p.key === "value");
  const why = `Price vs operating cash flow, a rough stand-in for price / funds from operations (how REITs are usually valued; depreciation makes P/E overstate them). Scored against the median of ${rv.n ?? "the"} fully scored REITs.`;
  for (const it of vp?.items ?? []) {
    if (it.key === "forwardPE" || it.key === "trailingPE") Object.assign(it, { key: it.key === "forwardPE" ? "pocf" : "pocf2", label: `Price / cash flow (in place of ${it.key === "forwardPE" ? "forward" : "trailing"} P/E)`, display: `${rv.pocf}× (REITs ${rv.median}×)`, why });
    if (it.key === "peg") Object.assign(it, { display: "n/a", why: "Not used for REITs: it is built on P/E." });
  }
  lt.reit = { pocf: rv.pocf, median: rv.median, n: rv.n ?? null };
  return lt;
}

<<<<<<< HEAD
// The P/E-based score a REIT would have had (for the "what changed" line), and
// the cash-flow score as a compact summary (sectorValue.reit; the plan book's
=======
// A REIT's cash-flow score as a compact summary (sectorValue.reit; the plan book's
>>>>>>> origin/main
// "reitValue" variant reads it, now the same as the agreed plan).
export function reitLongTerm(f, t, peer, rv) {
  const r = reitInputs(f, peer, rv);
  if (!r) return null;
  const lt = longTermLive(r.f, t, r.peer);
  if (lt.score == null) return null;
  return { score: lt.score, verdict: lt.verdict, value: lt.pillars.find((p) => p.key === "value")?.score ?? null, gaps: lt.gaps ?? [] };
}

// What the 10 Nov rule change did to this stock's verdict (null when nothing
// changed). old = longTerm(f, t) (rule before 10 Nov); live = longTermLive().
export function ruleChangeNote(old, live) {
  if (!old || !live || old.score == null || live.score == null || live.trust || old.verdict === live.verdict) return null;
  return { verdict: old.verdict, score: old.score, note: `Scoring changed on 10 and 11 Nov (value against sector peers, EV/EBITDA included from 11 Nov; new Entry rule with momentum)${live.reit ? "; REITs are valued on cash flow, not P/E, from 12 Nov" : ""}: ${live.verdict} now, ${old.verdict} (${old.score}) under the old rule.` };
}

// Adjust the long-term verdict note for the market regime.
export function regimeNote(regimeKey, verdict) {
  if (["capitulation", "correction"].includes(regimeKey) && ["Good entry", "Fair"].includes(verdict)) return "Market-wide fear is on your side: a good time to build long-term positions in stages.";
  if (["euphoric", "overheated"].includes(regimeKey) && verdict === "Good entry") return "The wider market is frothy. Consider a starter position and keep cash for a better entry.";
  if (regimeKey === "downtrend") return "The wider market is in a downtrend. Stage purchases rather than buying all at once.";
  return null;
}

export const daysUntil = (date, today) => (date ? Math.round((Date.parse(date) - Date.parse(today)) / 86400000) : null);

// Next and latest results dates for a stock. Yahoo keeps the results date for
// a day or so after the release, which showed as "-1 days" in the scan with no
// latest-results date (ALL and CF, 5 Nov 2026). A past "next" date is really
// the latest results: move it there and leave no next date.
export function earningsFields(next, last, today) {
  const days = daysUntil(next, today);
  if (next && days != null && days >= 0) return { earnings: { date: next, days }, lastEarnings: last ?? null };
  const past = [last, next].filter((d) => d && d <= today).sort().at(-1) ?? null;
  return { earnings: null, lastEarnings: past };
}

// No next results date published (Yahoo is often blank or stale for UK names:
// Unilever showed Feb 2026 as its latest results on 3 Nov): estimate the next
// one from the latest known date and the usual cadence: the median gap between
// past results in our history, else a quarter (91 days). Many UK companies
// report only half-yearly, so for them a quarter is the earliest likely date,
// the safe side for the 7-day rule ("uk-earliest"). If the estimate has already
// passed, the latest date is probably stale: roll forward and say so. Display
// only; never a reason to buy.
export function resultsEstimate(last, today, { uk = false, history = [] } = {}) {
  const past = [...history, last].filter((d) => d && d <= today).sort();
  if (!past.length) return null;
  const latest = past.at(-1);
  const gaps = [];
  for (let i = 1; i < past.length; i++) {
    const g = daysUntil(past[i], past[i - 1]);
    if (g >= 60 && g <= 200) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 91;
  const basis = gaps.length ? "history" : uk ? "uk-earliest" : "quarterly";
  let next = Date.parse(latest) + gap * 86400000;
  const t = Date.parse(today);
  while (next < t) next += gap * 86400000;
  // A half-yearly UK reporter skips one quarter; more than that is stale data.
  const stale = -daysUntil(latest, today) > gap * (basis === "uk-earliest" ? 2 : 1) + 14;
  const date = new Date(next).toISOString().slice(0, 10);
  return { date, days: daysUntil(date, today), basis, stale };
}

// Plain-English summary sentence for a stock.
export function summarise(item) {
  const bits = [];
  const lt = item.longTerm, sw = item.swing;
  if (lt?.score != null) {
    const strong = lt.pillars.filter((p) => p.score != null && p.score >= 65).map((p) => p.label.toLowerCase());
    const weak = lt.pillars.filter((p) => p.score != null && p.score < 40).map((p) => p.label.toLowerCase());
    bits.push(`Long-term: ${lt.verdict.toLowerCase()} (${lt.score}/100)${strong.length ? `, strong on ${strong.join(" and ")}` : ""}${weak.length ? `, weak on ${weak.join(" and ")}` : ""}.`);
  }
  if (sw) {
    const bull = item.signals.filter((s) => s.tone === "bull").map((s) => s.label.toLowerCase());
    const bear = item.signals.filter((s) => s.tone === "bear").map((s) => s.label.toLowerCase());
    bits.push(`Swing: ${sw.verdict.toLowerCase()}${bull.length ? ` (${bull.slice(0, 3).join(", ")})` : ""}${bear.length ? `; against: ${bear.slice(0, 2).join(", ")}` : ""}.`);
  }
  return bits.join(" ");
}
