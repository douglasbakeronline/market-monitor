# Market Monitor

A free, self-running market dashboard with phone alerts, plus a stock research page.

- **Dashboard** (`index.html`): one "market regime" headline built from four lenses (S&P 500 drawdown, trend vs the 200-day average, VIX, CNN Fear & Greed), what historically happened next at today's sentiment level, S&P 500 and FTSE 100 buy tiers, world markets and a rebound watchlist.
- **Research** (`research.html`): every stock on your list scored for **long-term** investing (quality, value, entry, analysts) and **swing** trading (trend, RSI, MACD, Bollinger, volume, breakouts), with plain-English reasons, a suggested stop and earnings warnings.
- **Alerts** (ntfy): buy tiers, "fear without a dip", greed and trim signals, research signals, a summary after each open and a Sunday digest.

Live at `https://douglasbakeronline.github.io/market-monitor/`. Not financial advice.

## How it runs

GitHub Actions runs `monitor.js` at these times (local market time, daylight saving handled):

| Slot | Time | Does |
|---|---|---|
| UK open | 08:15 London | Signals + UK summary |
| UK midday | 12:00 London | Signals |
| US open | 09:45 New York | Signals + US summary + F&G open capture |
| US midday | 12:45 New York | Signals |
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

## Layout

```
monitor.js              entry point
src/config.js           everything tunable
src/data/               CNN, Yahoo prices, Yahoo/Finnhub fundamentals
src/signals.js          snapshots, regime, alert rules
src/context.js          historical forward returns
src/research.js         long-term and swing scoring
src/runResearch.js      builds research.json
src/schedule.js         slot timing
scripts/                next-slot finder, commit/push helper
test/                   node:test suite
index.html, research.html, assets/   the site
```
