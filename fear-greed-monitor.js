// fear-greed-monitor.js
//
// Runs on a schedule in GitHub Actions. It:
//   1. Pulls the live CNN Fear & Greed Index (score, comparisons, history).
//   2. Pulls S&P 500 (SPY) and FTSE 100 (ISF.LON) daily prices from Alpha
//      Vantage for the drawdown and last-5-sessions, CACHED once per day to stay
//      inside the free 25-requests/day limit.
//   3. Records the Fear & Greed value at the US open and US close each day.
//   4. Writes data.json for the dashboard.
//   5. Pushes phone alerts (ntfy): buy/greed signals, plus a once-a-day summary
//      about 15 minutes after the UK and US opens (DST-aware).

import { readFile, writeFile } from "node:fs/promises";

const CONFIG = {
  buyTiers: [
    { drawdown: -10, label: "Correction (-10%)", note: "Watchlist. Consider a small add." },
    { drawdown: -15, label: "Meaningful dip (-15%)", note: "Add. This is where it gets interesting." },
    { drawdown: -20, label: "Bear territory (-20%)", note: "Large add. These don't come often." },
    { drawdown: -30, label: "Deep bear (-30%)", note: "Back up the truck (within your plan)." },
  ],
  buyFearConfirm: 25, greedScore: 76, greedMaxDrawdown: -3,
  buyResetDrawdown: -5, greedResetScore: 65, peakLookbackDays: 100, historyPoints: 400,

  // Rebound watch: large, liquid names. A "rebound candidate" is one that has
  // fallen >= reboundDropPct from its recent high over the last reboundWindow
  // trading days AND posted an up day at the last close. Daily data (free tier),
  // so this reflects the previous close, not the live open. Edit freely.
  // Yahoo/AV symbols: US = plain ticker; UK = ticker.LON.
  rebound: { dropPct: 8, window: 10 },
  dashboardUrl: "https://douglasbakeronline.github.io/market-monitor/",
  watchlist: [
    { symbol: "SPCX", name: "SpaceX" },
    { symbol: "MSFT", name: "Microsoft" },
    { symbol: "GOOGL", name: "Alphabet" },
    { symbol: "AAPL", name: "Apple" },
    { symbol: "AMZN", name: "Amazon" },
    { symbol: "NVDA", name: "Nvidia" },
    { symbol: "META", name: "Meta" },
    { symbol: "TSLA", name: "Tesla" },
    { symbol: "AVGO", name: "Broadcom" },
    { symbol: "AMD", name: "AMD" },
    { symbol: "V", name: "Visa" },
    { symbol: "JPM", name: "JPMorgan" },
    { symbol: "AZN.LON", name: "AstraZeneca" },
    { symbol: "SHEL.LON", name: "Shell" },
    { symbol: "HSBA.LON", name: "HSBC" },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Daily closes from Alpha Vantage. Free tier is 25 requests/day, so this is
// called at most twice a day thanks to the cache in main().
async function fetchSeries(symbol, tries = 2) {
  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key) { console.warn("No ALPHAVANTAGE_KEY set; price data unavailable."); return []; }
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${key}`;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const j = await res.json();
        const series = j["Time Series (Daily)"];
        if (series) {
          const rows = Object.entries(series)
            .map(([date, v]) => ({ date, close: parseFloat(v["4. close"]) }))
            .filter((x) => Number.isFinite(x.close))
            .sort((a, b) => (a.date < b.date ? -1 : 1)); // oldest first
          if (rows.length) return rows;
        }
        if (j.Note || j.Information) console.warn(`Alpha Vantage limit/info for ${symbol}: ${j.Note || j.Information}`);
      }
    } catch { /* network blip, retry */ }
    await sleep(1500 * attempt);
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

const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
const r1 = (n) => Number(n.toFixed(1));

// Rebound watch + per-stock detail for the accordion (today/yesterday/week/
// month and a 30-session rebased series). All derived from one fetch per name.
async function buildWatchlist() {
  const out = [];
  for (const w of CONFIG.watchlist) {
    await sleep(2000);
    const s = await fetchSeries(w.symbol);
    if (s.length < 2) continue;
    const c = s.map((x) => x.close);
    const last = c[c.length - 1];
    const recent = c.slice(-(CONFIG.rebound.window + 1));
    const high = Math.max(...recent);
    const dropFromHigh = pct(last, high);
    const lastChange = pct(last, c[c.length - 2]);
    const base = w.symbol.split(".")[0];
    const yahoo = w.symbol.endsWith(".LON") ? `${base}.L` : base;
    const win = c.slice(-30), b0 = win[0];
    out.push({
      symbol: base,
      yahoo,
      name: w.name,
      price: Number(last.toFixed(2)),
      dropFromHigh: r1(dropFromHigh),
      lastChange: r1(lastChange),
      today: r1(lastChange),
      yesterday: c.length >= 3 ? r1(pct(c[c.length - 2], c[c.length - 3])) : null,
      week: c.length >= 6 ? r1(pct(last, c[c.length - 6])) : null,
      month: c.length >= 22 ? r1(pct(last, c[c.length - 22])) : null,
      series: win.map((v) => Number((((v - b0) / b0) * 100).toFixed(2))),
      rebound: dropFromHigh <= -CONFIG.rebound.dropPct && lastChange > 0,
    });
  }
  return out;
}

// --- World markets (Option C: score + tiles + trend) ------------------------
// US and UK reuse the series already fetched for the drawdown; only Europe,
// Japan and China cost a new call each. Index proxies are liquid US-listed ETFs
// because Alpha Vantage's free tier is unreliable on raw foreign indices.
function marketSummary(name, symbol, s) {
  if (!s || s.length < 22) return null;
  const c = s.map((x) => x.close), last = c[c.length - 1];
  const win = c.slice(-30), b0 = win[0];
  return {
    name, symbol,
    dayPct: r1(pct(last, c[c.length - 2])),
    weekPct: r1(pct(last, c[c.length - 6])),
    series: win.map((v) => Number((((v - b0) / b0) * 100).toFixed(2))),
  };
}
function worldScore(markets) {
  let s = 0;
  for (const m of markets) {
    s += Math.max(-1, Math.min(1, m.dayPct / 1.5));  // day: ±1.5% saturates
    s += Math.max(-1, Math.min(1, m.weekPct / 4));   // week: ±4% saturates
  }
  return Math.round(Math.max(-10, Math.min(10, s)));
}
function worldLabel(s) {
  if (s >= 6) return "Risk-on, broad rally";
  if (s >= 2) return "Mostly up";
  if (s >= -1) return "Mixed / flat";
  if (s >= -5) return "Mostly down";
  return "Risk-off, broad sell-off";
}
async function fetchWorld(spx, ukx) {
  const defs = [
    { name: "US · S&P 500", symbol: "SPY", series: spx },
    { name: "UK · FTSE 100", symbol: "ISF", series: ukx },
    { name: "Europe · Euro Stoxx 50", symbol: "FEZ" },
    { name: "Japan · Nikkei", symbol: "EWJ" },
    { name: "China/HK · Hang Seng", symbol: "FXI" },
  ];
  const markets = [];
  for (const d of defs) {
    let series = d.series;
    if (!series) { await sleep(2000); series = await fetchSeries(d.symbol); }
    const m = marketSummary(d.name, d.symbol, series);
    if (m) markets.push(m);
  }
  if (!markets.length) return null;
  const score = worldScore(markets);
  return { score, label: worldLabel(score), markets };
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

// Markets whose session is currently open-or-later for the day. A late GitHub
// run still catches the session, and each market is deduped separately in main.
function marketsInSession() {
  const out = [];
  const uk = localParts("Europe/London");
  if (isWeekday(uk.weekday) && uk.min >= 8 * 60 && uk.min <= 16 * 60 + 30) out.push("UK");
  const us = localParts("America/New_York");
  if (isWeekday(us.weekday) && us.min >= 9 * 60 + 30 && us.min <= 16 * 60) out.push("US");
  return out;
}
function usCaptureWindow() {
  const us = localParts("America/New_York");
  if (!isWeekday(us.weekday)) return null;
  if (us.min >= 9 * 60 + 30 && us.min <= 10 * 60) return "open";
  if (us.min >= 15 * 60 + 45 && us.min <= 16 * 60 + 30) return "close";
  return null;
}
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
  await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers: {
      Title: title,
      Priority: "default",
      Tags: "bar_chart",
      Click: CONFIG.dashboardUrl, // tapping the notification opens the dashboard
    },
    body,
  });
}
async function loadState() { try { return JSON.parse(await readFile("./state.json", "utf8")); } catch { return { lastBuyTier: 0, greedActive: false, summarySent: {}, fearLog: {} }; } }
const saveState = (s) => writeFile("./state.json", JSON.stringify(s, null, 2));
const writeDashboardData = (p) => writeFile("./data.json", JSON.stringify(p));

// --- Main -------------------------------------------------------------------

async function main() {
  const [fg, state] = await Promise.all([fetchFearGreed(), loadState()]);
  const ns = { ...state, summarySent: { ...(state.summarySent || {}) }, fearLog: { ...(state.fearLog || {}) } };

  // Prices + rebound watch: fetch from Alpha Vantage once per day, cache the rest.
  const today = localDate("Europe/London");
  let dd, fiveDay, watchlist, world;
  if (ns.priceCache && ns.priceCache.date === today && ns.priceCache.dd) {
    dd = ns.priceCache.dd; fiveDay = ns.priceCache.fiveDay; watchlist = ns.priceCache.watchlist || []; world = ns.priceCache.world || null;
    console.log(`Using cached prices for ${today}.`);
  } else {
    const spx = await fetchSeries("SPY");
    await sleep(2000);
    const ukx = await fetchSeries("ISF.LON");
    dd = drawdownFrom(spx);
    fiveDay = { sp: lastFiveChanges(spx), ftse: lastFiveChanges(ukx) };
    world = await fetchWorld(spx, ukx);
    watchlist = await buildWatchlist();
    if (spx.length) ns.priceCache = { date: today, dd, fiveDay, watchlist, world }; // cache only on success
  }

  const status = currentStatus(fg.score, dd.drawdownPct);

  // Capture the Fear & Greed open/close for the current US trading day.
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
    status, fiveDay, fearSessions, watchlist, world,
  });

  const ev = evaluateAlerts(fg.score, dd, ns);
  Object.assign(ns, ev.newState);
  for (const a of ev.alerts) { console.log(`ALERT ${a.title}`); await notify(a); }

  // Daily summary: evaluate each market independently. Each fires once per day
  // on the first run at or after its open, so a late GitHub run still sends it.
  const sign = (p) => (p == null ? "n/a" : (p >= 0 ? "+" : "") + p + "%");
  const rebounds = (watchlist || []).filter((w) => w.rebound)
    .sort((a, b) => a.dropFromHigh - b.dropFromHigh)
    .map((w) => `${w.symbol} ${w.dropFromHigh}% off high, +${w.lastChange}% last`);
  const reboundLine = rebounds.length ? `\nRebound watch: ${rebounds.join("; ")}` : "\nRebound watch: none today.";
  const sp = fiveDay.sp.at(-1), ft = fiveDay.ftse.at(-1);

  const due = process.env.FORCE_SUMMARY ? ["US"] : marketsInSession();
  for (const market of due) {
    const tz = market === "UK" ? "Europe/London" : "America/New_York";
    const sumDay = localDate(tz);
    if (ns.summarySent[market] === sumDay && !process.env.FORCE_SUMMARY) continue;
    await notify({
      title: `${market} open · Fear & Greed ${fg.score} (${ratingFor(fg.score)})`,
      body: `${status.label}. S&P ${dd.drawdownPct.toFixed(1)}% off peak.\nLast close: S&P 500 ${sign(sp?.pct)}, FTSE 100 ${sign(ft?.pct)}.${reboundLine}`,
    });
    ns.summarySent[market] = sumDay;
    console.log(`Sent ${market} daily summary.`);
  }
  await saveState(ns);
}

main().catch((e) => { console.error("Monitor failed:", e); process.exit(1); });
