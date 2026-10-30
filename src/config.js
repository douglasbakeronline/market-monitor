// Central configuration. Everything you might want to tune lives here.

export const CONFIG = {
  dashboardUrl: "https://douglasbakeronline.github.io/market-monitor/",
  researchUrl: "https://douglasbakeronline.github.io/market-monitor/research.html",

  // Index and proxy symbols (Yahoo format first; Stooq and Alpha Vantage
  // fallbacks are mapped in src/data/prices.js).
  indices: {
    sp500: { symbol: "^GSPC", name: "S&P 500" },
    ftse: { symbol: "^FTSE", name: "FTSE 100" },
    vix: { symbol: "^VIX", name: "VIX" },
  },
  world: [
    { key: "sp500", name: "US · S&P 500", symbol: "^GSPC" },
    { key: "ftse", name: "UK · FTSE 100", symbol: "^FTSE" },
    { key: "stoxx", name: "Europe · Euro Stoxx 50", symbol: "^STOXX50E" },
    { key: "nikkei", name: "Japan · Nikkei 225", symbol: "^N225" },
    { key: "hsi", name: "Hong Kong · Hang Seng", symbol: "^HSI" },
  ],

  // Drawdown is measured from the highest close in this many trading days
  // (252 = one year). Used for both the S&P 500 and FTSE 100.
  peakLookbackDays: 252,

  buyTiers: [
    { drawdown: -10, label: "Correction (-10%)", note: "Watchlist. Consider a small add." },
    { drawdown: -15, label: "Meaningful dip (-15%)", note: "Add. This is where it gets interesting." },
    { drawdown: -20, label: "Bear territory (-20%)", note: "Large add. These don't come often." },
    { drawdown: -30, label: "Deep bear (-30%)", note: "Back up the truck (within your plan)." },
  ],
  buyFearConfirm: 25,      // F&G at or below this confirms a buy tier
  buyVixConfirm: 30,       // ...or VIX at or above this
  buyResetDrawdown: -5,    // tier memory clears once back within 5% of the high

  greedScore: 76,          // "stop buying" when F&G >= this and index near its high
  greedMaxDrawdown: -3,
  greedResetScore: 65,

  // Trim / rebalance: deliberately strict. Sentiment-based selling is weak on
  // its own, so it needs extreme greed AND a stretched market AND calm vol.
  trim: { enabled: true, minScore: 80, minAbove200Pct: 10, maxVix: 15, resetScore: 65 },

  // Crash watch: an urgent alert (sent even in quiet hours) when an index
  // falls this much in a day, or the VIX spikes. Fires once per market per day.
  crash: { dayDrop: -3, vixLevel: 30, vixJump: 25 },

  // "Fear without a dip": sentiment has turned but prices haven't (yet).
  fearNoDip: { maxScore: 30, minDrawdown: -5, resetScore: 40 },

  // Watchlist: large, liquid names shown on the dashboard's rebound watch.
  rebound: { dropPct: 8, window: 10 },
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
    { symbol: "AZN.L", name: "AstraZeneca" },
    { symbol: "SHEL.L", name: "Shell" },
    { symbol: "HSBA.L", name: "HSBC" },
  ],

  // Scheduled "slots" (local market time). The workflow sleeps until the next
  // one so timings are accurate to a minute or two, not hours.
  slots: [
    { id: "uk-open", tz: "Europe/London", time: "08:15", days: [1, 2, 3, 4, 5], summary: "UK" },
    { id: "uk-morning", tz: "Europe/London", time: "10:15", days: [1, 2, 3, 4, 5] },
    { id: "uk-midday", tz: "Europe/London", time: "12:00", days: [1, 2, 3, 4, 5] },
    { id: "us-open", tz: "America/New_York", time: "09:45", days: [1, 2, 3, 4, 5], summary: "US", fearCapture: "open" },
    { id: "us-late-morning", tz: "America/New_York", time: "11:00", days: [1, 2, 3, 4, 5] },
    { id: "us-midday", tz: "America/New_York", time: "12:45", days: [1, 2, 3, 4, 5] },
    { id: "us-afternoon", tz: "America/New_York", time: "14:30", days: [1, 2, 3, 4, 5] },
    { id: "us-close", tz: "America/New_York", time: "16:10", days: [1, 2, 3, 4, 5], fearCapture: "close", research: true },
    { id: "weekly-digest", tz: "Europe/London", time: "18:00", days: [0], digest: true, research: true },
  ],
  // Stale-data threshold: if index prices are older than this, flag the
  // monitor as unhealthy and stop evaluating price-based signals.
  staleHours: 96,

  // Quiet hours (London): alerts are held and delivered at the next run after
  // the window ends. Health alerts are never held.
  quietHours: { start: "22:00", end: "07:00", tz: "Europe/London" },

  historyPoints: 400,
};
