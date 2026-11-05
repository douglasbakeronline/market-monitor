# Changelog

Human-readable record of what changed and why. The weekly review deck is built from this file, the git log and the live data. Newest first. Bot data commits ("Update monitor data", "Update index scan") are not listed.

## Week of 2 November 2026

### Wed 4 Nov
- **Fixed: London dividend yields were 100× too small in the scan.** For the ~500 stocks that only get the quick pass, the yield came from Yahoo's quote, which divides a pound dividend by a pence price (GSK showed 0.04% instead of about 4%). Pence-quoted yields are now rescaled; the fully scored names already used the right figure. *Why:* the "dividend 3%+" screen silently missed most FTSE 100 income stocks.
- **Fixed: a pick that reported yesterday read "Next results in -1 days".** Yahoo keeps the results date for a day after the release; the tranche check now treats a past date as the latest results ("Reported Wed 4 Nov; next results not due for weeks"). Matters for CF Industries (bench), which reports today.
- **Stale-price guard in the scan.** A stock whose last daily bar is 3+ sessions behind its market (delisted, suspended or taken over, as Kenvue was on 30 Oct) is dropped from the scan and listed as failed, so it can't sit in the lists on an old price.
- **Research log:** does buying well below the 52-week high help? No: over 6 to 12 months the evidence favours stocks near their highs (momentum), so our Entry pillar leans the wrong way. Change proposed, to be tested on our own data first.

### Tue 3 Nov
- **Fixed: an investment trust topped the long-term scan.** Polar Capital Technology Trust scored 96 ("Good entry", new today) on a P/E of 1.8. A trust's "earnings" are its portfolio gains, so P/E, margins and ROE say nothing about value. Closed-end funds (FTSE sector "Closed End Investments", or a name ending "Investment Trust plc") now show the verdict "Investment trust" with no score or pillar strengths, and a note to judge them on the discount to net asset value, costs and holdings. Affects PCT, FCIT, SMT, ALW and PSH; US REITs named "Investment Trust" (Federal Realty) are still scored as companies. *Why:* the scan's top slot and "new good entries" line should never be a fund.
- **Research log:** is extreme fear on its own a buy signal? No: low sentiment predicts little; F&G stays a confirmation for price-based tiers.

### Mon 2 Nov
- **Fixed: tranche check said "No results date known" for HSBC and Newmont** although both reported in late October (27 Oct and 22 Oct). Yahoo drops the date once results are out and before the next date is announced. The research and scan now keep the latest results date (`lastEarnings`), and a pick that reported within 60 days passes with "Reported Tue 27 Oct; next results not due for weeks." *Why:* a vague "check before buying" on the first tranche day made Douglas do a manual lookup the tool can answer.
- **Fixed:** the "Nothing due this week" headline lower-cased the whole title ("vwrp").

## Week of 26 October 2026

### Sun 1 Nov (weekly sprint)
- **"Your plan this week" at the top of the Dashboard** (co-pilot reframe, Douglas 30 Oct). Reads the agreed plan (`src/plan.js`, dates and percentages only) and shows what is due in the next seven days, a tranche check for each of the five picks (still a good entry, no results within 7 days), the pullback rule's distance to its trigger, and key dates. *Why:* the top of the page should answer "what, if anything, should I do this week?"
- **Pullback-rule alert.** If the S&P 500 or FTSE 100 is 5%+ below its high before a scheduled core date, one high-priority alert says to bring that purchase forward (the April 2027 date is excluded: that money can't enter the ISA early). Plan lines also lead the Monday UK summary and the Sunday digest.
- **Pots and goal panel, private to the browser.** Enter pot values, monthly top-up and goal; see weights vs the 60/15/15/10 targets, drift of 5+ points, and time to goal at 6/8/10%. Saved in localStorage only, so no amounts reach the public repo.
- **Swing paper-trading log.** Every clean swing setup from the nightly scan is logged (entry next open, 2×ATR stop, 2R target, 20-session exit) in `history/paper-trades.json` and scored nightly; summary and recent trades on the Dashboard. *Why:* the swing pot should prove itself before real money.
- **Swing backtest** (`tools/swing-backtest.mjs`): the same rules replayed over the past year on all 603 index stocks. Result in the research log: no edge over random entry (details there).
- **Fixed: swing stops too tight on some stocks.** Not a data bug: DCC, Intertek, easyJet, Bio-Techne and AES have prices pinned by takeover offers (daily moves under 0.4% vs a usual 1.5% to 2.7%). Such stocks are now flagged "Price pinned", never a swing setup, and their long-term verdict says the upside is capped. Stops also get a floor of 2× the stock's normal daily move.
- **Research list** now includes the five picks and the bench, so their earnings dates and full scores feed the tranche check; stocks newly added to the list are recorded silently instead of triggering "new signal" alerts.
- **Public repo scrub:** removed a legacy holding name and a personal amount from the strategy notes and research log (they remain in older git history).

### Fri 30 Oct
- **Trends page** (Douglas asked to track trending, tech, AI and growth stocks, Finviz as reference): 8 hand-picked themes (AI chips, AI platforms, AI software, AI infrastructure and power, cybersecurity, consumer/fintech growth, space and defence, healthcare innovation) with benchmark ETFs, an S&P 500 sector heatmap, and momentum/52-week-high/movers lists from the nightly scan. Built nightly by trends.js after the scan. Ticker links go to Finviz (US) or Yahoo (UK).
- **Reviews page** listing public-safe weekly reviews (no personal holdings or amounts); full personal reviews stay private as PDFs.
- **Crash watch:** urgent alerts for a 3%+ daily index fall or VIX spike; two extra weekday checks.
- **Plan agreed:** core 70% (VWRP), long-term picks 15%, opportunity reserve 15%, swing paper-traded only. Half the core invested 30 Oct, the rest in three monthly instalments (Dec, Jan, Feb). Strategy notes and research log added for the daily sessions; daily research-and-build session starts Mon 2 Nov 08:33.

### Thu 29 Oct
- **Scanner highlights in summaries.** The UK/US summaries and Sunday digest now include a line from the index scan (good entries, new names, swing setups). Strategy deck written for Douglas (kept private, not in this repo); its build items are on the roadmap.
- **Index scanner (S&P 500 + FTSE 100).** Nightly two-stage scan of ~600 companies: quick score for all, full fundamentals for the top ~100 candidates and every swing setup. New "Index scan" view on the Research page with Finviz-style screens (sector, full scores, RSI < 30, above 200-day, P/E ≤ 20, dividend ≥ 3%, new today). Runs in its own workflow so it can never delay alerts. *Why:* Douglas asked whether the tool covered whole indices; it only covered 16 placeholder stocks.
- **Signal track record.** Every alert is logged with its price and scored against what happened next (1 week, 1 month, 3 months) and against the S&P 500. Dashboard section + digest line. Signals need a week of trading before they count. Backfilled from git history (2 signals so far). *Why:* to show whether the signals are worth acting on.
- **Score history and weekly score change** per stock on the Research page.
- **Earnings reactions.** The move around each company's latest results (close before to close after), on the Research page and in summaries. *Context:* Alphabet fell 11.5% around its 28 Oct results.
- **Research alerts explain themselves.** They now say the previous verdict, the day's move, and warn when results are due within a week. *Trigger:* the first research alert (Amazon, 29 Oct) fired on its earnings day without saying so.

### Tue 27 Oct
- **Market Monitor v2 (all 25 review items).** Self-chaining scheduler (runs at exact times instead of ~5 hours late); safe stale-data handling and health alerts; Fear & Greed dates fixed; collision guard; Node 24; ntfy retries; Yahoo Finance replaces Alpha Vantage; 52-week drawdown; regime headline; fear-without-a-dip, trim and FTSE tiers; historical context since 2020; richer summaries, Sunday digest, quiet hours (22:00 to 07:00); Research page with long-term and swing scoring; dark mode; tests in CI; dry-run mode.
- **Verified:** the 08:15 UK open slot fired at 08:15:09 on its first morning.
