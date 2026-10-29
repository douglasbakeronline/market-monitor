// Market snapshots, the regime headline and alert rules. Pure functions so
// they can be unit-tested without network access.
import { CONFIG } from "./config.js";
import { sma, rsi, drawdown, lastChanges, changeOver, rebase } from "./indicators.js";
import { pct, r1, r2, utcDate } from "./util.js";
import { ratingFor } from "./data/feargreed.js";

export function snapshot(name, symbol, data) {
  const rows = data?.rows;
  if (!rows || rows.length < 30) return null;
  const closes = rows.map((r) => r.close);
  const s50 = sma(closes, 50), s200 = sma(closes, 200), rs = rsi(closes, 14);
  const last = closes[closes.length - 1];
  const dd = drawdown(rows, CONFIG.peakLookbackDays);
  const m200 = s200[s200.length - 1];
  return {
    name, symbol,
    level: r2(last), date: rows[rows.length - 1].date, asOf: data.asOf ?? null, currency: data.currency ?? null,
    drawdownPct: r1(dd.pct), peak: r2(dd.peak), peakDate: dd.peakDate,
    sma50: r2(s50[s50.length - 1]), sma200: r2(m200),
    vs200Pct: m200 ? r1(pct(last, m200)) : null,
    above200: m200 ? last > m200 : null,
    rsi14: r1(rs[rs.length - 1]),
    dayPct: r1(changeOver(closes, 1)), weekPct: r1(changeOver(closes, 5)), monthPct: r1(changeOver(closes, 21)),
    ytdPct: r1(ytd(rows)),
    fiveDay: lastChanges(rows, 5),
    series: rebase(closes, 30),
  };
}

function ytd(rows) {
  const y = rows[rows.length - 1].date.slice(0, 4);
  const prev = [...rows].reverse().find((r) => r.date.slice(0, 4) < y);
  return prev ? pct(rows[rows.length - 1].close, prev.close) : null;
}

export function deepestTier(dd) {
  let hit = null;
  if (dd == null) return null;
  for (const t of CONFIG.buyTiers) if (dd <= t.drawdown) hit = t;
  return hit;
}

// --- Regime -----------------------------------------------------------------
// One headline that combines price (drawdown), trend (200-day), volatility
// (VIX) and sentiment (Fear & Greed). Precedence matters: the first match wins.
export function regime({ sp, vix, fg }) {
  const score = fg?.score ?? null, dd = sp?.drawdownPct ?? null, v = vix?.level ?? null;
  const factors = [
    sp && { key: "drawdown", label: "Drawdown", value: `${dd.toFixed(1)}%`, tone: dd <= -10 ? "buy" : dd <= -5 ? "watch" : "neutral", note: `S&P 500 vs its 52-week high (${Math.round(sp.peak).toLocaleString("en-GB")}).` },
    sp && sp.vs200Pct != null && { key: "trend", label: "Trend", value: `${sp.vs200Pct >= 0 ? "+" : ""}${sp.vs200Pct.toFixed(1)}% vs 200-day`, tone: sp.above200 ? (sp.vs200Pct >= 10 ? "greed" : "neutral") : "caution", note: sp.above200 ? "Above its 200-day average: the long-term trend is up." : "Below its 200-day average: the long-term trend is down." },
    v != null && { key: "vix", label: "Volatility", value: `VIX ${v.toFixed(1)}`, tone: v >= 30 ? "buy" : v >= 20 ? "watch" : v <= 13 ? "greed" : "neutral", note: v >= 30 ? "Panic-level volatility; historically near bottoms." : v >= 20 ? "Elevated: investors are paying up for protection." : v <= 13 ? "Very calm; complacency can build here." : "Normal range." },
    score != null && { key: "sentiment", label: "Sentiment", value: `F&G ${score}`, tone: score <= 25 ? "buy" : score <= 44 ? "watch" : score >= 76 ? "greed" : "neutral", note: `CNN Fear & Greed: ${ratingFor(score)}.` },
  ].filter(Boolean);

  const base = { factors };
  if (!sp || score == null) return { ...base, key: "unknown", tone: "neutral", label: "Data unavailable", action: "Signals paused until fresh data arrives." };

  const tier = deepestTier(dd);
  const panic = score <= CONFIG.buyFearConfirm || (v != null && v >= CONFIG.buyVixConfirm);
  const t = CONFIG.trim;

  if (tier && panic) return { ...base, key: "capitulation", tone: "buy", label: `Capitulation · ${tier.label}`, action: tier.note };
  if (tier) return { ...base, key: "correction", tone: "watch", label: `${tier.label}, no panic yet`, action: "Prices are down but fear isn't extreme. Scale in slowly; save bigger adds for when fear confirms." };
  if (t.enabled && score >= t.minScore && (sp.vs200Pct ?? 0) >= t.minAbove200Pct && (v == null || v <= t.maxVix))
    return { ...base, key: "overheated", tone: "sell", label: "Overheated", action: "Extreme greed, stretched prices, calm volatility. Consider trimming winners back to your target allocation." };
  if (score >= CONFIG.greedScore && dd >= CONFIG.greedMaxDrawdown)
    return { ...base, key: "euphoric", tone: "greed", label: "Euphoric", action: "Stop deploying new money. Build cash for the next dip." };
  if (score <= CONFIG.fearNoDip.maxScore && dd > CONFIG.fearNoDip.minDrawdown)
    return { ...base, key: "fear-no-dip", tone: "watch", label: "Nervous, but no dip yet", action: "Sentiment has cracked before prices have. Get your shopping list ready; don't chase." };
  if (dd <= -5 && sp.above200)
    return { ...base, key: "pullback", tone: "buy-lite", label: "Pullback in an uptrend", action: "A reasonable moment for regular long-term adds." };
  if (sp.above200 === false)
    return { ...base, key: "downtrend", tone: "caution", label: "Below the 200-day: trend is down", action: "Be patient. Prefer staged buys over lump sums." };
  return { ...base, key: "healthy", tone: "neutral", label: "Healthy uptrend", action: "Nothing to do. Keep regular investing going." };
}

// Per-market buy status, used for both the S&P 500 and FTSE 100 cards.
export function marketStatus(snap, fg, vix) {
  if (!snap) return null;
  const tier = deepestTier(snap.drawdownPct);
  const panic = (fg?.score ?? 100) <= CONFIG.buyFearConfirm || (vix?.level ?? 0) >= CONFIG.buyVixConfirm;
  const next = CONFIG.buyTiers.find((t) => snap.drawdownPct > t.drawdown);
  return {
    tier: tier?.label ?? null,
    type: tier ? (panic ? "buy" : "watch") : "neutral",
    nextTier: next ? { label: next.label, distance: r1(next.drawdown - snap.drawdownPct) } : null,
  };
}

// --- Alerts -----------------------------------------------------------------
// Each rule fires once when its condition becomes true and re-arms when the
// condition clears (hysteresis), so you're not pinged repeatedly.
export function evaluateAlerts({ markets, fg, vix, pricesOk, fgOk }, state) {
  const alerts = [];
  const ns = structuredClone({ buyTier: {}, watchTier: {}, greedActive: false, trimActive: false, fearNoDipActive: false, ...state });
  const score = fg?.score;
  const panic = fgOk && (score <= CONFIG.buyFearConfirm || (vix?.level ?? 0) >= CONFIG.buyVixConfirm);

  if (pricesOk) {
    for (const [market, snap] of Object.entries(markets)) {
      if (!snap) continue;
      const dd = snap.drawdownPct, tier = deepestTier(dd);
      const lastBuy = ns.buyTier[market] ?? 0, lastWatch = ns.watchTier[market] ?? 0;
      if (tier && panic && tier.drawdown < lastBuy) {
        alerts.push({ kind: "buy", market, priority: "high", tags: "green_circle,moneybag",
          title: `BUY · ${snap.name} ${tier.label}`,
          body: `${snap.name} ${dd.toFixed(1)}% off its 52-week high. Fear & Greed ${score} (${ratingFor(score)})${vix?.level ? `, VIX ${vix.level.toFixed(1)}` : ""}.\n${tier.note}` });
        ns.buyTier[market] = tier.drawdown;
      } else if (tier && !panic && fgOk && tier.drawdown < lastWatch && tier.drawdown < lastBuy) {
        alerts.push({ kind: "watch", market, priority: "default", tags: "yellow_circle",
          title: `WATCH · ${snap.name} ${tier.label}`,
          body: `${snap.name} ${dd.toFixed(1)}% off its high, but sentiment isn't panicking (F&G ${score}). Scale in slowly; wait for fear to confirm bigger adds.` });
        ns.watchTier[market] = tier.drawdown;
      }
      if (dd >= CONFIG.buyResetDrawdown) { ns.buyTier[market] = 0; ns.watchTier[market] = 0; }
    }
  }

  const sp = markets.US;
  if (fgOk && pricesOk && sp) {
    const greedy = score >= CONFIG.greedScore && sp.drawdownPct >= CONFIG.greedMaxDrawdown;
    if (greedy && !ns.greedActive) {
      alerts.push({ kind: "greed", priority: "default", tags: "red_circle",
        title: `GREED · Euphoric (${score})`,
        body: `Fear & Greed ${score}, S&P 500 within ${Math.abs(sp.drawdownPct).toFixed(1)}% of its high. Stop deploying new money; build cash for the next dip.` });
      ns.greedActive = true;
    }
    if (score < CONFIG.greedResetScore) ns.greedActive = false;

    const t = CONFIG.trim;
    const trim = t.enabled && score >= t.minScore && (sp.vs200Pct ?? 0) >= t.minAbove200Pct && (vix?.level == null || vix.level <= t.maxVix);
    if (trim && !ns.trimActive) {
      alerts.push({ kind: "trim", priority: "high", tags: "scissors",
        title: `TRIM · Market overheated`,
        body: `Fear & Greed ${score}, S&P ${sp.vs200Pct.toFixed(1)}% above its 200-day, VIX ${vix?.level?.toFixed(1) ?? "n/a"}. Consider trimming winners back to target weights. Not a call to sell everything.` });
      ns.trimActive = true;
    }
    if (score < t.resetScore) ns.trimActive = false;

    const f = CONFIG.fearNoDip;
    const fnd = score <= f.maxScore && sp.drawdownPct > f.minDrawdown;
    if (fnd && !ns.fearNoDipActive) {
      alerts.push({ kind: "fear-no-dip", priority: "low", tags: "eyes",
        title: `HEADS-UP · Fear without a dip`,
        body: `Fear & Greed ${score} (${ratingFor(score)}) but the S&P is only ${Math.abs(sp.drawdownPct).toFixed(1)}% off its high. Sentiment often cracks before prices: get your shopping list ready.` });
      ns.fearNoDipActive = true;
    }
    if (score >= f.resetScore) ns.fearNoDipActive = false;
  }
  return { alerts, state: ns };
}

// Rebound watch: big caps that have dropped and just posted an up day.
export function watchItem(w, data) {
  const rows = data?.rows;
  if (!rows || rows.length < 3) return null;
  const c = rows.map((r) => r.close), last = c[c.length - 1];
  const high = Math.max(...c.slice(-(CONFIG.rebound.window + 1)));
  const dropFromHigh = pct(last, high), lastChange = pct(last, c[c.length - 2]);
  const yahoo = w.symbol;
  return {
    symbol: w.symbol.replace(/\.L$/, ""), yahoo, name: w.name, currency: data.currency,
    price: r2(last), date: rows[rows.length - 1].date,
    dropFromHigh: r1(dropFromHigh), lastChange: r1(lastChange),
    previous: c.length >= 3 ? r1(pct(c[c.length - 2], c[c.length - 3])) : null,
    week: r1(changeOver(c, 5)), month: r1(changeOver(c, 21)),
    series: rebase(c, 30),
    rebound: dropFromHigh <= -CONFIG.rebound.dropPct && lastChange > 0,
  };
}

// Fear & Greed by US session for the last five trading days.
export function buildFearSessions(history, fearLog) {
  const pts = history.slice(-6), res = [];
  for (let i = Math.max(1, pts.length - 5); i < pts.length; i++) {
    const cur = pts[i], prev = pts[i - 1], date = cur.date ?? utcDate(cur.t), log = fearLog[date] || {};
    const open = log.open ?? null, close = log.close ?? cur.y;
    const basis = open != null ? "oc" : "dod";
    const p = open != null ? ((close - open) / open) * 100 : ((cur.y - prev.y) / prev.y) * 100;
    res.push({ date, open, close, pct: Math.round(p * 10) / 10, basis });
  }
  return res;
}

