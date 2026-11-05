# Roadmap

Working plan for Market Monitor. Claude develops this autonomously (Douglas granted full freedom on 29 Oct 2026) and reports weekly via a PDF review deck. Keep this file current: move items to the changelog when shipped.

## Principles
- Never break the alert chain. Test (`npm test`), dry-run on the `dryrun` branch with real data, lint workflows (`actionlint`), then push to main.
- Every number on screen should explain itself. Prefer fewer, clearer signals over more noise.
- No paid services. No secrets in the repo (it's public).

## Waiting on Douglas
- **Where the swing 10% sits while swing is on paper:** cash in the ISA (default), the dip reserve, or the core?
- OK to keep the five pick names in the public repo (they drive the Dashboard tranche check)? Alternative: load the plan from the browser like the pots panel.
- His own research list (Research page still uses a placeholder, now including the picks and bench).
- Optional `FINNHUB_KEY` secret.
- Whether to keep the trim signal (on, strict).
- **Sector-relative valuation and a cyclical cap (research log 2 Nov):** OK to let it change verdicts, including for Newmont and CF? Until then it ships as display-only notes.
- **Entry pillar and momentum (research log 4 Nov):** OK to test, and if our own data agrees, change the Entry pillar so it stops rewarding stocks 20% to 30% off their high (and add 12-month momentum)? It would change verdicts and the pick tranche check.
- **Dip reserve size (research log 5 Nov):** keep 15% in cash, or shrink the drag (unused reserve drips into the core over 6 months, or a 10% reserve with 5% more in the core)?
- Delete leftover branch `probe` (`dryrun` is reused for testing; keep it).

## Next up (in priority order)
1. **Swing retune (Douglas, 5 Nov: paper, but retune):** test stricter setups (score 75+, uptrend only, US only, no results within 10 days) with `tools/swing-backtest.mjs`, compare with the random-entry baseline, and adopt only what beats it by a clear margin after FX costs.
2. **Smart-money signal (Autopilot as reference):** Congress disclosures plus 13F holdings of a few long-term managers as a tracked tie-breaker tag on Research and scan pages, scored in the track record like any other signal.
3. **Sector-relative valuation:** score P/E and EV/EBITDA against sector medians from the scan instead of fixed bands, plus a cyclical flag (see research log 2 Nov; SNDK at P/E 4 tops the scan). Ship as notes first; verdict change waits on Douglas.
4. **Entry-pillar test (own data):** forward 6 and 12-month returns of index stocks by distance from the 52-week high and by 12-1 month momentum, in the buy-tier backtest harness (research log 4 Nov). Runs in CI (Yahoo is blocked from the session sandbox).
5. **Backtest the buy tiers** over S&P history since 1985 (Yahoo monthly) and since 2020 with F&G, to calibrate thresholds; same harness style as the swing backtest.
6. **Track-record page:** per-signal-type hit rates and returns once there are enough signals (from about December).
7. **Performance:** split research.json/scan.json loading so the phone view stays fast; consider gzip-friendly field names.
8. **Paper-trade view on the Research page:** filter by market and setup score, with an equity curve in R.
9. **Trade log follow-ups:** show the dip-reserve tiers in the adherence list once a tier fires; optional pots-panel fill from the log; remind in the Monday playback when a scheduled action shows Not logged.

## Data notes (spot checks)
- 3 Nov: stops (2×ATR), P/E and yields checked on WDC, TMUS, UAL: consistent. Yahoo's latest-results date is stale for some UK names (Unilever shows Feb 2026); the pick check then says "no results date" (safe, not a false pass), but worth a fallback from `history/earnings.json` or company calendars. Kenvue's price stopped on 30 Oct (likely delisted after the Kimberly-Clark deal); stale-price guard added 4 Nov.
- 3 Nov: earnings dated the day before the scan showed "-1 days" (fixed 4 Nov in the tranche check; the scan lists already hide past dates).

- 4 Nov: three random items (KLAC, FRT, MRO): stops, 52-week range and off-high consistent. KLAC's low price and -49% off high follow its 10-for-1 split (May 2026); worth a split check in the 52-week high once the y1 return is missing. Found and fixed: UK quote dividend yields 100× too small. Charter's P/E of 2.4 looks odd but matches its collapsed price.
- 4 Nov: trade log (Next up 1) not started; today went on the three data bugs above.
- 5 Nov: NVDA, ALL, MRO, NVR checked: stops (2×ATR), 52-week ranges and yields consistent; NVDA's forward P/E of 12.6 (trailing 25.3) is Yahoo's next-year estimate, plausible given +106% revenue growth. Found and fixed: 1-year return missing for every US stock (251 sessions in a "1y" download). Still open: the scan shows a results date of "-1 days" with no latest-results fallback (ALL, CF); the plan check handles it, the scan lists hide it.

## Done (recent)
- 5 Nov: trade log with plan adherence (browser only); 1-year return fix for US stocks.
- 4 Nov: UK dividend yield fix, "-1 days" results label in the tranche check, stale-price guard.
- 3 Nov: investment trusts are no longer scored as companies (PCT had topped the scan at 96).
- 2 Nov: tranche check uses the latest results date when no next date is published (HSBC, Newmont).
- 1 Nov: plan-this-week panel, pullback-rule alert, private pots and goal panel, swing paper-trading log and backtest, pinned-price (takeover) detection and stop floor. See CHANGELOG.

## Later
- More indices (Euro Stoxx 50, Nasdaq 100) in the scanner.
- Insider buying and short interest signals (needs a free source).
- Price alerts for individual stocks set from the Research page.
