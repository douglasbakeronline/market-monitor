# Roadmap

Working plan for Market Monitor. Claude develops this autonomously (Douglas granted full freedom on 29 Oct 2026) and reports weekly via a PDF review deck. Keep this file current: move items to the changelog when shipped.

## Principles
- Never break the alert chain. Test (`npm test`), dry-run on the `dryrun` branch with real data, lint workflows (`actionlint`), then push to main.
- Every number on screen should explain itself. Prefer fewer, clearer signals over more noise.
- No paid services. No secrets in the repo (it's public).

## Waiting on Douglas
- **Swing pot on 16 Nov: fund it or keep it on paper?** The 1 Nov backtest found no edge (+0.04R per trade vs +0.10R for random entry with the same exits; see RESEARCH-LOG). Recommendation: paper only for now.
- Strategy notes conflict: the 30 Oct changelog says "swing paper-traded only", STRATEGY-NOTES says real money from 16 Nov. Needs one answer (follows from the decision above).
- OK to keep the five pick names in the public repo (they drive the Dashboard tranche check)? Alternative: load the plan from the browser like the pots panel.
- His own research list (Research page still uses a placeholder, now including the picks and bench).
- Optional `FINNHUB_KEY` secret.
- Whether to keep the trim signal (on, strict).
- **Sector-relative valuation and a cyclical cap (research log 2 Nov):** OK to let it change verdicts, including for Newmont and CF? Until then it ships as display-only notes.
- Delete leftover branch `probe` (`dryrun` is reused for testing; keep it).

## Next up (in priority order)
1. **Trade log (browser only):** (not started yet) record each real trade with the rule that triggered it (core date, pick tranche, dip tier, pullback rule), feed the pots panel from it, and show plan adherence ("4 of 4 scheduled actions done on time").
2. **Swing retune (only if Douglas wants swing kept alive):** test stricter setups (score 75+, uptrend only, US only, no results within 10 days) with `tools/swing-backtest.mjs`, compare with the random-entry baseline, and adopt only what beats it by a clear margin after FX costs.
3. **Smart-money signal (Autopilot as reference):** Congress disclosures plus 13F holdings of a few long-term managers as a tracked tie-breaker tag on Research and scan pages, scored in the track record like any other signal.
4. **Sector-relative valuation:** score P/E and EV/EBITDA against sector medians from the scan instead of fixed bands, plus a cyclical flag (see research log 2 Nov; SNDK at P/E 4 tops the scan). Ship as notes first; verdict change waits on Douglas.
5. **Backtest the buy tiers** over S&P history since 1985 (Yahoo monthly) and since 2020 with F&G, to calibrate thresholds; same harness style as the swing backtest.
6. **Track-record page:** per-signal-type hit rates and returns once there are enough signals (from about December).
7. **Performance:** split research.json/scan.json loading so the phone view stays fast; consider gzip-friendly field names.
8. **Paper-trade view on the Research page:** filter by market and setup score, with an equity curve in R.

## Data notes (spot checks)
- 3 Nov: stops (2×ATR), P/E and yields checked on WDC, TMUS, UAL: consistent. Yahoo's latest-results date is stale for some UK names (Unilever shows Feb 2026); the pick check then says "no results date" (safe, not a false pass), but worth a fallback from `history/earnings.json` or company calendars. Kenvue's price stopped on 30 Oct (likely delisted after the Kimberly-Clark deal); drop names whose last bar is 3+ sessions old.
- 3 Nov: earnings dated the day before the scan show "-1 days" in the scan list; harmless, but could read "reported yesterday".

## Done (recent)
- 3 Nov: investment trusts are no longer scored as companies (PCT had topped the scan at 96).
- 2 Nov: tranche check uses the latest results date when no next date is published (HSBC, Newmont).
- 1 Nov: plan-this-week panel, pullback-rule alert, private pots and goal panel, swing paper-trading log and backtest, pinned-price (takeover) detection and stop floor. See CHANGELOG.

## Later
- More indices (Euro Stoxx 50, Nasdaq 100) in the scanner.
- Insider buying and short interest signals (needs a free source).
- Price alerts for individual stocks set from the Research page.
