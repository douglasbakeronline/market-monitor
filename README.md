# Market Monitor

A free, self-running market dashboard with phone alerts, plus a stock research page.

- **Dashboard** (`index.html`): what the agreed plan says is due this week (with a tranche check for each pick, the pullback rule and the core fund, VWRP, in pounds), a private pots-and-goal panel stored only in your browser, one "market regime" headline built from four lenses (S&P 500 drawdown, trend vs the 200-day average, VIX, CNN Fear & Greed), what historically happened next at today's sentiment level, S&P 500 and FTSE 100 buy tiers, world markets and a rebound watchlist.
- **Research** (`research.html`): every stock on your list scored for **long-term** investing (quality, value, entry, analysts) and **swing** trading (trend, RSI, MACD, Bollinger, volume, breakouts), with plain-English reasons, a suggested stop and earnings warnings. An "Index scan" tab scores every company in the S&P 500, FTSE 100 and Euro Stoxx 50 (plus the Nasdaq 100 names those miss) each weeknight.
- **Alerts** (ntfy): buy tiers, "fear without a dip", greed and trim signals, research signals, a summary after each open and a Sunday digest.

Live at `https://douglasbakeronline.github.io/market-monitor/`. Not financial advice.

## How it runs

GitHub Actions runs `monitor.js` at these times (local market time, daylight saving handled):

| Slot | Time | Does |
|---|---|---|
| UK open | 08:15 London | Signals + UK summary (with this week's plan on Mondays) |
| UK morning | 10:15 London | Signals + crash watch |
| UK midday | 12:00 London | Signals |
| US open | 09:45 New York | Signals + US summary + F&G open capture |
| US late morning | 11:00 New York | Signals + crash watch |
| US midday | 12:45 New York | Signals |
| US afternoon | 14:30 New York | Signals |
| US close | 16:10 New York | Signals + F&G close capture + research refresh |
| Weekly digest | Sunday 18:00 London | Digest + research refresh |

GitHub's own cron is unreliable (it was running ~5 hours late), so the workflow uses it only to *wake up*. Each run sleeps until the next slot, runs it, then starts the next run itself. The cron lines restart the chain if it ever breaks. Only one run is active at a time.

Alerts between 22:00 and 07:00 London are held until the morning (except "monitor problem" alerts).

## Data sources

| Data | Source | Key needed |
|---|---|---|
| Fear & Greed + its 7 components + history since 2020 | CNN | No |
| Index and stock prices (daily, 10 years for the S&P) | Yahoo Finance | No |
| Fundamentals, analyst targets, earnings dates (US and UK) | Yahoo Finance | No |
| Backup fundamentals for US stocks | Finnhub | Optional: `FINNHUB_KEY` |
| Backup prices for US stocks | Alpha Vantage | Optional: `ALPHAVANTAGE_KEY` |

If data can't be fetched, the dashboard keeps the last good values, marks them stale, pauses price-based signals (they never fire or reset on missing data) and sends one "monitor problem" alert.

## Secrets (Settings → Secrets and variables → Actions)

- `NTFY_TOPIC` (required): your private ntfy topic.
- `FINNHUB_KEY`, `ALPHAVANTAGE_KEY` (optional): only used as fallbacks.

Workflow permissions must be "Read and write" (Settings → Actions → General).

## Editing

- **Price alerts:** `price-alerts.json` (or build it with "Add or change an alert" on the Dashboard and paste it in on GitHub). Levels are in the quote currency (pence for `.L` shares).
- **Trade log (Dashboard, browser only):** log trades by hand, or import a Trading 212 history CSV (History, download, CSV); trades with shares and prices value the pots and picks at today's prices.
- **Research list:** `research-list.json`. Yahoo symbols: US plain (`MSFT`), UK with `.L` (`AZN.L`). Remove `"placeholder": true` once it's your real list.
- **Dashboard watchlist, thresholds, schedule, quiet hours:** `src/config.js`.

## Running locally (Node 22+)

```bash
npm test                 # unit tests (no network)
npm run dry-run          # real data, no alerts, writes to ./dry-run/
npm run research         # dry run that also rebuilds research
FORCE_SUMMARY=US NTFY_TOPIC=your-topic node monitor.js   # send a real summary now
```

## Signals in brief

- **Buy tiers:** -10 / -15 / -20 / -30% from the 52-week high, each confirmed by fear (F&G ≤ 25 or VIX ≥ 30). Separate for the S&P 500 and FTSE 100. Re-arm once back within 5% of the high.
- **Watch:** a tier is hit but fear hasn't confirmed it.
- **Fear without a dip:** F&G ≤ 30 while the S&P is within 5% of its high.
- **Greed:** F&G ≥ 76 with the S&P within 3% of its high: stop adding.
- **Trim:** F&G ≥ 80, S&P 10%+ above its 200-day and VIX ≤ 15: rebalance, don't dump.
- **Research:** a stock newly becomes a long-term "Good entry" or a swing "Setup".
- **Price alerts:** a stock you listed reaches your level; once per crossing, re-armed after a 3% move back.
- **Pullback rule:** the S&P 500 or FTSE 100 is 5%+ below its high before a scheduled core purchase: bring it forward.

## Layout

```
monitor.js              entry point
src/config.js           everything tunable
src/data/               CNN, Yahoo prices, Yahoo/Finnhub fundamentals
src/signals.js          snapshots, regime, alert rules
src/context.js          historical forward returns
src/research.js         long-term and swing scoring (flags takeover-pinned prices)
src/priceAlerts.js      price alerts for individual stocks (price-alerts.json)
src/rebalance.js        pots panel rebalancing view (new money to targets, pick sizes; display only)
src/plan.js             the agreed plan as data (dates, weights, picks) and the weekly co-pilot
src/paperTrades.js      swing paper-trading log, scored nightly by scan.js
tools/swing-backtest.mjs  replay of the swing rules over four years, with retune variants
src/swingRetune.js      swing variant comparison vs random entry, after costs
tools/smart-backtest.mjs  do the tracked 13F managers' new or added positions beat the market? (src/smartBacktest.js)
src/runResearch.js      builds research.json
src/schedule.js         slot timing
scripts/                next-slot finder, commit/push helper
test/                   node:test suite
index.html, research.html, assets/   the site
```
