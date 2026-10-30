# Roadmap

Working plan for Market Monitor. Claude develops this autonomously (Douglas granted full freedom on 29 Oct 2026) and reports weekly via a PDF review deck. Keep this file current: move items to the changelog when shipped.

## Principles
- Never break the alert chain. Test (`npm test`), dry-run on the `dryrun` branch with real data, lint workflows (`actionlint`), then push to main.
- Every number on screen should explain itself. Prefer fewer, clearer signals over more noise.
- No paid services. No secrets in the repo (it's public).

## Waiting on Douglas
- His own research list (Research page still uses a 16-stock placeholder).
- Optional `FINNHUB_KEY` secret.
- Whether to keep the trim signal (on, strict).
- Delete leftover branches `probe` (and `dryrun` is reused for testing; keep it).

## Next up (in priority order)
0. **Bug: swing stops too tight on some FTSE stocks.** DCC and EZJ showed 2×ATR stops only 0.5% to 1.2% below price on 29 Oct (US names look normal at 5% to 8%). Likely Yahoo returning flat or missing intraday highs/lows for some LSE bars. Fix: guard ATR with a close-to-close volatility floor and flag stocks with poor OHLC data; add a test.
1. **Goal tracker:** progress to £100,000 (target set by Douglas) with projections at 6/8/10% and the effect of monthly top-ups; pullback-rule alert (index 5%+ off its high before a scheduled core date).
1b. **Co-pilot reframe (Douglas, 30 Oct):** the monitor becomes an investing co-pilot: pots vs target weights from docs/STRATEGY-NOTES.md, what is due this week, plan adherence, then signals and research. Dashboard top section should answer "what, if anything, should I do this week?"
2. **Swing paper-trading log:** record scanner swing setups as paper trades (entry, 2×ATR stop, 2R target, 20-session exit) and score them automatically; the swing pot is only funded if this shows positive expectancy after 3+ months.
3. **Smart-money signal (Autopilot as reference):** Congress disclosures plus 13F holdings of a few long-term managers as a tracked tie-breaker tag.
4. **Portfolio view and trade log (agreed in the 29 Oct strategy deck):** pots with target weights (core index, dip reserve, long-term picks, swing), current value vs target, a trade log where every trade records the rule that triggered it, and rebalancing prompts. Keep amounts out of the public repo: read holdings from a private source or let Douglas enter them in the browser (localStorage), not committed files.
5. **Congress-trade flag (fold into 3):** check for a free, reliable feed of US House/Senate trade disclosures; if one exists, add a "Congress buying" tag on Research and scan pages, tracked in the track record like any other signal. Use only as a tie-breaker.
6. **Sector-relative valuation:** score P/E and EV/EBITDA against sector medians from the scan instead of fixed bands.
7. **Track-record page:** per-signal-type hit rates and returns once there are enough signals (needs ~1 month of data).
8. **Backtest the buy tiers** over S&P history since 1985 (Yahoo monthly) and since 2020 with F&G, to calibrate thresholds.
9. **Performance:** split research.json/scan.json loading so the phone view stays fast; consider gzip-friendly field names.

## Later
- More indices (Euro Stoxx 50, Nasdaq 100) in the scanner.
- Insider buying and short interest signals (needs a free source).
- Price alerts for individual stocks set from the Research page.
