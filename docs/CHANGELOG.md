# Changelog

Human-readable record of what changed and why. The weekly review deck is built from this file, the git log and the live data. Newest first. Bot data commits ("Update monitor data", "Update index scan") are not listed.

## Week of 26 October 2026

### Thu 29 Oct
- **Index scanner (S&P 500 + FTSE 100).** Nightly two-stage scan of ~600 companies: quick score for all, full fundamentals for the top ~100 candidates and every swing setup. New "Index scan" view on the Research page with Finviz-style screens (sector, full scores, RSI < 30, above 200-day, P/E ≤ 20, dividend ≥ 3%, new today). Runs in its own workflow so it can never delay alerts. *Why:* Douglas asked whether the tool covered whole indices; it only covered 16 placeholder stocks.
- **Signal track record.** Every alert is logged with its price and scored against what happened next (1 week, 1 month, 3 months) and against the S&P 500. Dashboard section + digest line. Signals need a week of trading before they count. Backfilled from git history (2 signals so far). *Why:* to show whether the signals are worth acting on.
- **Score history and weekly score change** per stock on the Research page.
- **Earnings reactions.** The move around each company's latest results (close before to close after), on the Research page and in summaries. *Context:* Alphabet fell 11.5% around its 28 Oct results.
- **Research alerts explain themselves.** They now say the previous verdict, the day's move, and warn when results are due within a week. *Trigger:* the first research alert (Amazon, 29 Oct) fired on its earnings day without saying so.

### Tue 27 Oct
- **Market Monitor v2 (all 25 review items).** Self-chaining scheduler (runs at exact times instead of ~5 hours late); safe stale-data handling and health alerts; Fear & Greed dates fixed; collision guard; Node 24; ntfy retries; Yahoo Finance replaces Alpha Vantage; 52-week drawdown; regime headline; fear-without-a-dip, trim and FTSE tiers; historical context since 2020; richer summaries, Sunday digest, quiet hours (22:00 to 07:00); Research page with long-term and swing scoring; dark mode; tests in CI; dry-run mode.
- **Verified:** the 08:15 UK open slot fired at 08:15:09 on its first morning.
