// fear-greed-monitor.js
//
// Runs on a schedule in GitHub Actions. It:
//   1. Pulls the live CNN Fear & Greed Index (score, comparisons, history).
//   2. Pulls S&P 500 and FTSE 100 prices (drawdown + last 5 daily % changes).
//   3. Records the Fear & Greed value at the US open and US close each day, so
//      the dashboard can show per-day open/close over time (CNN only publishes
//      one value per day, so this is built up live; it cannot be backfilled).
//   4. Pulls top US/UK one-day gainers (FMP), with each stock's move since open.
//   5. Writes data.json for the dashboard.
//   6. Pushes phone alerts (ntfy): event-based buy/greed signals, plus a once-a-day
//      summary roughly 15 minutes after the UK and US opens (DST-aware).

import { readFile, writeFile } from "node:fs/promises";

const CONFIG = {
  buyTiers: [
    { drawdown: -10, label: "Correction (-10%)", note: "Watchlist. Consider a small add." },
    { drawdown: -15, label: "Meaningful dip (-15%)", note: "Add. This is where it gets interesting." },
    { drawdown: -20, label: "Bear territory (-20%)", note: "Large add. These don't come often." },
    { drawdown: -30, label: "Deep bear (-30%)", note: "Back up the truck (within your plan)." },
  ],
  buyFearConfirm: 25, greedScore: 76, greedMaxDrawdown: -3,
  buyResetDrawdown: -5, greedResetScore: 65, peakLookbackDays: 2500, historyPoints: 400,
  // Your research candidates, NOT recommendations. Edit freely.
  // Stooq symbols: US = ticker.us, UK = ticker.uk.
  watchlist: [
    { symbol: "msft.us", name: "Microsoft" },
    { symbol: "googl.us", name: "Alphabet" },
    { symbol: "v.us", name: "Visa" },
    { symbol: "ma.us", name: "Mastercard" },
    { symbol: "asml.us", name: "ASML" },
    { symbol: "azn.uk", name: "AstraZeneca" },
  ],
};

function ratingFor(s) {
  if (s <= 24) return "extreme fear";
  if (s <= 44) return "fear";
  if (s <= 55) return "neutral";
  if (s <= 75) return "greed";
  return "extreme greed";
}

// --- Data sources -----------------------------------------------------------

async function fetchFearGreed() {
  const res = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
    { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", accept: "application/json" } });
  if (!res.ok) throw new Error(`Fear & Greed fetch failed: ${res.status}`);
  const data = await res.json();
  const fg = data.fear_and_greed;
  const history = (data.fear_and_greed_historical?.data ?? []).slice(-CONFIG.historyPoints).map((d) => ({ t: d.x, y: Math.round(d.y) }));
  return {
    score: Math.round(fg.score),
    comparisons: { close: Math.round(fg.previous_close), week: Math.round(fg.previous_1_week), month: Math.round(fg.previous_1_month), year: Math.round(fg.previous_1_year) },
    history,
  };
}

async function fetchSeries(symbol, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`,
        { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36" } });
      if (res.ok) {
        const rows = (await res.text()).trim().split("\n").slice(1)
          .map((r) => { const c = r.split(","); return { date: c[0], close: parseFloat(c[4]) }; })
          .filter((x) => Number.isFinite(x.close));
        if (rows.length) return rows;
      }
    } catch { /* network blip, retry */ }
    await new Promise((r) => setTimeout(r, 700 * attempt));
  }
  console.warn(`No data for ${symbol} after ${tries} tries.`);
  return [];
}

function drawdownFrom(series) {
  if (!series.length) return { last: 0, peak: 0, drawdownPct: 0 };
  const recent = series.slice(-CONFIG.peakLookbackDays);
  const last = recent[recent.length - 1].close;
  const peak = Math.max(...recent.map((x) => x.close));
  return { last, peak, drawdownPct: ((last - peak) / peak) * 100 };
}

function lastFiveChanges(series) {
  const tail = series.slice(-6), out = [];
  for (let i = 1; i < tail.length; i++)
    out.push({ date: tail[i].date, pct: Number((((tail[i].close - tail[i - 1].close) / tail[i - 1].close) * 100).toFixed(2)) });
  return out;
}

async function fetchMovers() {
  const key = process.env.FMP_KEY;
  if (!key) return { us: [], uk: [], ukAvailable: false };
  const pct = (x) => parseFloat(String(x).replace(/[()%+\s]/g, ""));
  const fromOpen = (q) => (q.open ? Number((((q.price - q.open) / q.open) * 100).toFixed(2)) : null);
  const mapRow = (q) => ({ symbol: q.symbol, name: q.name || q.symbol, price: q.price, openPct: fromOpen(q) });
  const rank = (arr) => (Array.isArray(arr) ? arr : []).filter((q) => Number.isFinite(pct(q.changesPercentage)))
    .sort((a, b) => pct(b.changesPercentage) - pct(a.changesPercentage)).slice(0, 10);
  let us = [], uk = [], ukAvailable = true;
  try {
    const g = await fetch(`https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${key}`);
    if (g.ok) {
      const top = rank(await g.json()), syms = top.map((r) => r.symbol).join(",");
      let quotes = [];
      try { const q = await fetch(`https://financialmodelingprep.com/api/v3/quote/${syms}?apikey=${key}`); if (q.ok) quotes = await q.json(); } catch {}
      const openBy = Object.fromEntries((quotes || []).map((q) => [q.symbol, q.open]));
      us = top.map((r) => mapRow({ ...r, open: openBy[r.symbol] }));
    }
  } catch {}
  try { const r = await fetch(`https://financialmodelingprep.com/api/v3/quotes/LSE?apikey=${key}`); if (r.ok) uk = rank(await r.json()).map(mapRow); else ukAvailable = false; } catch { ukAvailable = false; }
  return { us, uk, ukAvailable };
}

// Last 5 sessions for each watchlist ticker (daily % plus the 5-day total).
async function fetchWatchlist() {
  const out = [];
  await Promise.all(CONFIG.watchlist.map(async (w) => {
    try {
      const s = await fetchSeries(w.symbol);
      if (s.length < 6) return;
      const last = s[s.length - 1].close, base = s[s.length - 6].close;
      out.push({
        symbol: w.symbol.split(".")[0].toUpperCase(),
        name: w.name,
        price: last,
        total: Number((((last - base) / base) * 100).toFixed(2)),
        fiveDay: lastFiveChanges(s),
      });
    } catch { /* skip a ticker that fails rather than break the run */ }
  }));
  const order = CONFIG.watchlist.map((w) => w.name);
  return out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

// --- Signals ----------------------------------------------------------------

function deepestTierHit(d) { let h = null; for (const t of CONFIG.buyTiers) if (d <= t.drawdown) h = t; return h; }

function currentStatus(score, dd) {
  const tier = deepestTierHit(dd), confirmed = score <= CONFIG.buyFearConfirm;
  const greedy = score >= CONFIG.greedScore && dd >= CONFIG.greedMaxDrawdown;
  if (greedy) return { type: "greed", label: "Euphoric", note: "Stop deploying. Build cash for the next dip." };
  if (tier && confirmed) return { type: "buy", label: tier.label, note: tier.note };
  if (tier && !confirmed) return { type: "watch", label: `${tier.label}, sentiment not yet capitulated`, note: "Price is down but fear isn't extreme. Wait for confirmation." };
  return { type: "neutral", label: "No active signal", note: "Sit tight. Nothing interesting right now." };
}

function evaluateAlerts(score, dd, state) {
  const alerts = [], ns = { ...state };
  const tier = deepestTierHit(dd.drawdownPct), confirmed = score <= CONFIG.buyFearConfirm;
  if (tier && tier.drawdown < (state.lastBuyTier ?? 0) && confirmed) {
    alerts.push({ title: `BUY signal: ${tier.label}`, body: `S&P ${dd.drawdownPct.toFixed(1)}% off its peak. Fear & Greed ${score} (${ratingFor(score)}). ${tier.note}` });
    ns.lastBuyTier = tier.drawdown;
  }
  if (dd.drawdownPct >= CONFIG.buyResetDrawdown) ns.lastBuyTier = 0;
  const greedy = score >= CONFIG.greedScore && dd.drawdownPct >= CONFIG.greedMaxDrawdown;
  if (greedy && !state.greedActive) { alerts.push({ title: `GREED signal: euphoric (${score})`, body: `Fear & Greed ${score}, S&P near its peak. Stop deploying; build a buffer for the next dip.` }); ns.greedActive = true; }
  if (score < CONFIG.greedResetScore) ns.greedActive = false;
  return { alerts, newState: ns };
}

// --- Timezone helpers (DST handled by Intl) ---------------------------------

function localParts(tz) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { min: +g("hour") * 60 + +g("minute"), weekday: g("weekday") };
}
const localDate = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const isoET = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
const isWeekday = (wd) => !["Sat", "Sun"].includes(wd);

function openMarket() {
  const uk = localParts("Europe/London");
  if (isWeekday(uk.weekday) && uk.min >= 8 * 60 + 15 && uk.min <= 9 * 60 + 45) return "UK";
  const us = localParts("America/New_York");
  if (isWeekday(us.weekday) && us.min >= 9 * 60 + 45 && us.min <= 11 * 60) return "US";
  return null;
}

// Which US-session edge are we near? Used to capture the index open/close.
function usCaptureWindow() {
  const us = localParts("America/New_York");
  if (!isWeekday(us.weekday)) return null;
  if (us.min >= 9 * 60 + 30 && us.min <= 10 * 60) return "open";
  if (us.min >= 15 * 60 + 45 && us.min <= 16 * 60 + 30) return "close";
  return null;
}

// Build the last 5 sessions of Fear & Greed. Close comes from the captured
// close if we have it, otherwise CNN's daily value. Open comes only from our
// own capture (CNN does not publish it), so older days show day-over-day %.
function buildFearSessions(history, fearLog) {
  const pts = history.slice(-6), res = [], start = Math.max(1, pts.length - 5);
  for (let i = start; i < pts.length; i++) {
    const cur = pts[i], prev = pts[i - 1], key = isoET(cur.t), log = fearLog[key] || {};
    const open = log.open ?? null, close = log.close ?? cur.y;
    let pct, basis;
    if (open != null) { pct = ((close - open) / open) * 100; basis = "oc"; }
    else { pct = ((cur.y - prev.y) / prev.y) * 100; basis = "dod"; }
    res.push({ date: key, open, close, pct: Number(pct.toFixed(1)), basis });
  }
  return res;
}

// --- Notify + persistence ---------------------------------------------------

async function notify({ title, body }) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) { console.log(`[no NTFY_TOPIC] ${title}\n${body}`); return; }
  await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: { Title: title, Priority: "default", Tags: "bar_chart" }, body });
}
async function loadState() { try { return JSON.parse(await readFile("./state.json", "utf8")); } catch { return { lastBuyTier: 0, greedActive: false, summarySent: {}, fearLog: {} }; } }
const saveState = (s) => writeFile("./state.json", JSON.stringify(s, null, 2));
const writeDashboardData = (p) => writeFile("./data.json", JSON.stringify(p));

// --- Main -------------------------------------------------------------------

async function main() {
  const [fg, spx, ukx, movers, watchlist, state] = await Promise.all([fetchFearGreed(), fetchSeries("^spx"), fetchSeries("^ukx"), fetchMovers(), fetchWatchlist(), loadState()]);
  const dd = drawdownFrom(spx);
  const fiveDay = { sp: lastFiveChanges(spx), ftse: lastFiveChanges(ukx) };
  const status = currentStatus(fg.score, dd.drawdownPct);

  const ns = { ...state, summarySent: { ...(state.summarySent || {}) }, fearLog: { ...(state.fearLog || {}) } };

  // Capture the index open/close for the current US trading day.
  const usDate = localDate("America/New_York"), cap = usCaptureWindow();
  if (cap === "open" && ns.fearLog[usDate]?.open == null) ns.fearLog[usDate] = { ...(ns.fearLog[usDate] || {}), open: fg.score };
  if (cap === "close") ns.fearLog[usDate] = { ...(ns.fearLog[usDate] || {}), close: fg.score };
  const fk = Object.keys(ns.fearLog).sort(); while (fk.length > 12) delete ns.fearLog[fk.shift()];

  const fearSessions = buildFearSessions(fg.history, ns.fearLog);
  console.log(`F&G ${fg.score} (${ratingFor(fg.score)}) | S&P ${dd.drawdownPct.toFixed(1)}% off peak`);

  await writeDashboardData({
    updated: new Date().toISOString(), score: fg.score, rating: ratingFor(fg.score),
    comparisons: fg.comparisons, history: fg.history,
    drawdownPct: Number(dd.drawdownPct.toFixed(1)), last: Math.round(dd.last), peak: Math.round(dd.peak),
    status, fiveDay, fearSessions, movers, watchlist,
  });

  const ev = evaluateAlerts(fg.score, dd, ns);
  Object.assign(ns, ev.newState);
  for (const a of ev.alerts) { console.log(`ALERT ${a.title}`); await notify(a); }

  const market = process.env.FORCE_SUMMARY ? "US" : openMarket();
  if (market) {
    const tz = market === "UK" ? "Europe/London" : "America/New_York", today = localDate(tz);
    if (ns.summarySent[market] !== today || process.env.FORCE_SUMMARY) {
      const sp = fiveDay.sp.at(-1), ft = fiveDay.ftse.at(-1), sign = (p) => (p == null ? "n/a" : (p >= 0 ? "+" : "") + p + "%");
      await notify({
        title: `${market} open · Fear & Greed ${fg.score} (${ratingFor(fg.score)})`,
        body: `${status.label}. S&P ${dd.drawdownPct.toFixed(1)}% off peak.\nLast close: S&P 500 ${sign(sp?.pct)}, FTSE 100 ${sign(ft?.pct)}.`,
      });
      ns.summarySent[market] = today;
      console.log(`Sent ${market} daily summary.`);
    }
  }
  await saveState(ns);
}

main().catch((e) => { console.error("Monitor failed:", e); process.exit(1); });
