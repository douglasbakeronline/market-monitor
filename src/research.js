// Stock research scoring. Two lenses:
//   Long-term (hold for years): Quality, Value, Entry, Analyst sentiment.
//   Swing (days to weeks): a set of technical signals on daily bars.
// Every score comes with plain-English reasons so the number means something.
import { sma, rsi, macd, bollinger, atr, crossed, changeOver, rebase } from "./indicators.js";
import { interp, mean, pct, r1, r2, clamp } from "./util.js";

const FIN_SECTORS = ["Financial Services", "Financials"];

// --- Technicals ------------------------------------------------------------
export function technicals(rows) {
  if (!rows || rows.length < 60) return null;
  const c = rows.map((r) => r.close), v = rows.map((r) => r.volume || 0);
  const n = c.length - 1, last = c[n];
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200);
  const rs = rsi(c, 14), m = macd(c), bb = bollinger(c, 20, 2), at = atr(rows, 14), vAvg = sma(v, 20);
  const win = rows.slice(-252);
  const high52 = Math.max(...win.map((r) => r.high ?? r.close)), low52 = Math.min(...win.map((r) => r.low ?? r.close));
  const priorHigh = Math.max(...rows.slice(-253, -1).map((r) => r.close));
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
    dayPct: changeOver(c, 1), weekPct: changeOver(c, 5), monthPct: changeOver(c, 21), m3Pct: changeOver(c, 63), y1Pct: changeOver(c, 252),
    high52, low52, offHigh: pct(last, high52), rangePos: high52 > low52 ? (last - low52) / (high52 - low52) : null,
    breakout: last >= priorHigh * 0.995 && rows.length > 200,
    series: rebase(c, 120),
  };
}

// --- Swing signals ---------------------------------------------------------
// Each signal: { key, label, tone: "bull"|"bear", weight, why }.
export function swingSignals(t) {
  if (!t) return [];
  const s = [];
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
  const stop = t.atr ? r2(t.last - 2 * t.atr) : null;
  return { score, verdict, stop, stopPct: stop ? r1(pct(stop, t.last)) : null, atrPct: r1(t.atrPct), notes };
}

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
  rsi: [[25, 95], [35, 85], [45, 70], [55, 55], [65, 40], [75, 20], [85, 5]],
  upside: [[-15, 0], [0, 30], [10, 55], [20, 75], [35, 95], [50, 100]],
  rec: [[1.2, 90], [1.8, 70], [2.3, 50], [2.8, 32], [3.3, 15], [4, 0]],
};

const metric = (key, label, value, display, why) => ({ key, label, value, display, score: value == null ? null : Math.round(interp(value, P[key])), why });

export function longTerm(f, t) {
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
  const value = [
    metric("forwardPE", "Forward P/E", f?.forwardPE > 0 ? f.forwardPE : null, fx(f?.forwardPE), "Price vs next year's expected earnings. Lower is cheaper."),
    metric("trailingPE", "Trailing P/E", f?.trailingPE > 0 ? f.trailingPE : null, fx(f?.trailingPE), "Price vs the last 12 months' earnings."),
    metric("peg", "PEG", f?.peg > 0 ? f.peg : null, fx(f?.peg, 2), "P/E divided by growth. Around 1 or below is good value for the growth."),
    fin ? null : metric("evToEbitda", "EV / EBITDA", f?.evToEbitda > 0 ? f.evToEbitda : null, fx(f?.evToEbitda), "Whole-company value vs operating earnings."),
  ].filter(Boolean);

  const entry = [
    metric("offHigh", "Off 52-week high", t?.offHigh, t?.offHigh == null ? "n/a" : `${t.offHigh.toFixed(1)}%`, "A discount to the recent high improves the entry, within reason."),
    metric("vs200", "vs 200-day", t?.vs200, t?.vs200 == null ? "n/a" : `${t.vs200 >= 0 ? "+" : ""}${t.vs200.toFixed(1)}%`, "Close to or modestly below the long-term average is a calmer entry than far above it."),
    metric("rsi", "RSI (14)", t?.rsi, fx(t?.rsi, 0), "Below ~40 is a cooled-off entry; above ~70 is stretched."),
  ];

  const sentiment = [
    metric("upside", "Upside to target", upside, upside == null ? "n/a" : `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%`, `Analysts' average price target${f?.analysts ? ` (${f.analysts} analysts)` : ""}.`),
    metric("rec", "Analyst rating", f?.recommendationMean, f?.recommendationMean == null ? "n/a" : `${f.recommendationMean.toFixed(1)} (${(f.recommendationKey || "").replace("_", " ")})`, "1 = strong buy, 3 = hold, 5 = sell."),
  ];

  const pillar = (key, label, weight, items) => ({ key, label, weight, items, score: mean(items.map((i) => i.score)) == null ? null : Math.round(mean(items.map((i) => i.score))) });
  const pillars = [
    pillar("quality", "Quality", 0.32, quality),
    pillar("value", "Value", 0.32, value),
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
  else if (score >= 72 && (get("entry") ?? 0) >= 70 && (get("quality") ?? 50) >= 55 && (get("value") ?? 50) >= 45) {
    verdict = falling ? "Fair" : "Good entry";
    if (falling) note = "Quality at a discount, but the trend is still down. Buy in stages rather than all at once.";
  }
  else if (score >= 55) verdict = "Fair";

  return { score, verdict, note, falling, pillars, coverage, financials: fin };
}

// Adjust the long-term verdict note for the market regime.
export function regimeNote(regimeKey, verdict) {
  if (["capitulation", "correction"].includes(regimeKey) && ["Good entry", "Fair"].includes(verdict)) return "Market-wide fear is on your side: a good time to build long-term positions in stages.";
  if (["euphoric", "overheated"].includes(regimeKey) && verdict === "Good entry") return "The wider market is frothy. Consider a starter position and keep cash for a better entry.";
  if (regimeKey === "downtrend") return "The wider market is in a downtrend. Stage purchases rather than buying all at once.";
  return null;
}

export const daysUntil = (date, today) => (date ? Math.round((Date.parse(date) - Date.parse(today)) / 86400000) : null);

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
