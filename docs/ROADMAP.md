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
1. **Scanner alerts and summary lines:** surface new full-score good entries and top swing setups from the index scan in the UK/US summaries and the digest (no separate pings).
2. **Sector-relative valuation:** score P/E and EV/EBITDA against sector medians from the scan instead of fixed bands.
3. **Track-record page:** per-signal-type hit rates and returns once there are enough signals (needs ~1 month of data).
4. **Portfolio view:** holdings, weights vs target, rebalancing prompts tied to the trim signal (needs holdings from Douglas, or a placeholder).
5. **Backtest the buy tiers** over S&P history since 1985 (Yahoo monthly) and since 2020 with F&G, to calibrate thresholds.
6. **Performance:** split research.json/scan.json loading so the phone view stays fast; consider gzip-friendly field names.

## Later
- More indices (Euro Stoxx 50, Nasdaq 100) in the scanner.
- Insider buying and short interest signals (needs a free source).
- Price alerts for individual stocks set from the Research page.
