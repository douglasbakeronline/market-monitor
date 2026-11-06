# Roadmap

Working plan for Market Monitor. Claude develops this autonomously (Douglas granted full freedom on 29 Oct 2026) and reports weekly via a PDF review deck. Keep this file current: move items to the changelog when shipped.

## Principles
- Never break the alert chain. Test (`npm test`), dry-run on the `dryrun` branch with real data, lint workflows (`actionlint`), then push to main.
- Every number on screen should explain itself. Prefer fewer, clearer signals over more noise.
- No paid services. No secrets in the repo (it's public).

## Waiting on Douglas
- OK to keep the five pick names in the public repo (they drive the Dashboard tranche check)? Alternative: load the plan from the browser like the pots panel.
- His own research list (Research page still uses a placeholder, now including the picks and bench).
- Optional `FINNHUB_KEY` secret.
- Whether to keep the trim signal (on, strict).
- **Sector-relative valuation and a cyclical cap (research log 2 Nov, effect 5 Nov late):** OK to let it change verdicts? Now live as a display-only "Peer view" on the Research page. On 5 Nov it would change 7 of 109 full-score verdicts: CF, Super Micro and Glencore drop from Good entry to Fair (cyclical cap); Newmont stays Fair (value 71 to 60); the other four picks keep their verdicts.
- **Entry pillar and momentum (research log 4 Nov, tested 5 Nov night):** our own ten-year test agrees: stocks 10% to 30% off their high did no better than those near it, and strong momentum helped. OK to change the Entry pillar so it stops rewarding a 20% to 30% discount, and add 12-1 month momentum? It would change verdicts and the pick tranche check. Now visible as a display-only "Entry view" on the Research page: on 6 Nov it changes 14 of 108 full-score verdicts; of the picks, HSBC and Meta stay Good entry and Newmont, Constellation and VICI stay Fair; bench Schwab drops to Fair.
- **Dip reserve size (research log 5 Nov; tested 6 Nov midday and afternoon):** keep 15% in cash, or shrink the drag (unused reserve drips into the core over 6 months, or a 10% reserve with 5% more in the core)? Our backtest since 1988: the 15% reserve trails investing it all by a median 1.0% to 1.2% of final wealth over 10 years (S&P, a 60/40 S&P/FTSE blend and ACWI since 2008, with either index firing the tiers as live); 10% costs about 0.7%, the 6-month drip 0.4%.
- **Add the `SEC_CONTACT` secret (6 Nov):** Douglas agreed to use his email for SEC. He adds it himself: repo Settings, Secrets and variables, Actions, New repository secret, name `SEC_CONTACT` (Claude cannot set secrets).
- Delete leftover branch `probe` (`dryrun` is reused for testing; keep it).

## Next up (in priority order)
1. **Smart-money signal (Autopilot as reference):** Congress disclosures plus 13F holdings of a few long-term managers as a tracked tie-breaker tag on Research and scan pages, scored in the track record like any other signal. *Step 1 done 6 Nov:* `src/smartMoney.js` (parse, merge, quarter-on-quarter change, ticker tags via `smartTag()`) and `tools/smart-money.mjs` (EDGAR plus OpenFIGI, cache in `data/cusip-map.json`). *Blocker:* SEC EDGAR returned 403 (an HTML block page) to GitHub's runners on 6 Nov with a declared generic user agent. Next: (a) Douglas agreed 6 Nov to use his email; the fetcher reads it from the `SEC_CONTACT` repo secret (never in the code). Once he has added the secret, pass it as env to the dry run and rerun (retried 6 Nov midday: still 403, so the secret is probably not added yet), else (b) a fallback source for the same filings; then run weekly in scan.yml (13F changes only quarterly), add the tag to scan items and the Research page, log tagged picks in the track record. Congress disclosures still need a free, stable source (House PTRs are PDFs).
2. **Sector-relative valuation, step 2 (after Douglas's OK only):** the peer view shipped 5 Nov as display-only notes. To switch verdicts, pass `peerFor(f, medians)` as the third argument of `longTerm()` in `scan.js` (stage 2) and `src/runResearch.js`. Open points: EV/EBITDA still uses fixed bands (only the ~100 deepened stocks have it, a biased-cheap sample; fetch it for all or skip); REITs should use P/FFO, not P/E (peer P/E lifts most REITs); US and UK share one median per sector (UK multiples run lower).
3. **Entry pillar, step 2 (after Douglas's OK only):** the test ran 5 Nov (research log). If agreed: change `P.offHigh` in `src/research.js` to flat from -3% to -20% with no extra credit beyond, add 12-1 month momentum as an Entry item (needs 13 months of prices: the scan fetches "1y", so switch it to "2y" or compute from 253 bars), and rerun the dry run to count changed verdicts. The "Entry view" note (6 Nov midday, display only) already uses these bands (`P.offHighAlt`, `P.mom`, `entryAlt` option of `longTerm()`): switching means making them the live bands. On 6 Nov it would change 14 of 108 full-score verdicts (Good entry lost: SCHW, INVP.L, COF, STJ.L, KEY; gained: SNDK, APA). Note SNDK gains on +715% momentum while the peer view flags it cyclical: if both changes go in, check them together.
4. **Track-record page:** per-signal-type hit rates and returns once there are enough signals (from about December).
5. **Trade log follow-ups:** show the dip-reserve tiers in the adherence list once a tier fires; optional pots-panel fill from the log; remind in the Monday playback when a scheduled action shows Not logged.
6. **Split check in the 52-week high (data note 4 Nov):** KLAC showed -58% off its high after a 10-for-1 split (May 2026) on 6 Nov, but with a -13% day and -34% month in the chip sell-off it is unclear how much is real. Next: compare Yahoo's `splits` events (`events=split` on the chart call) with the 52-week window and rescale pre-split bars, or flag "split in range" on the item. Needs a dry run to see the raw bars.
7. **Results estimate follow-up:** the scan has no results history (only the research list keeps `history/earnings.json`), so scan estimates use a flat quarter. Option: record scan results dates too (about 600 symbols, small file) so gaps are learned per stock.

## Data notes (spot checks)
- 3 Nov: stops (2×ATR), P/E and yields checked on WDC, TMUS, UAL: consistent. Yahoo's latest-results date is stale for some UK names (Unilever shows Feb 2026); addressed 6 Nov afternoon with an estimated next date flagged "looks stale" (8 scan stocks). Kenvue's price stopped on 30 Oct (likely delisted after the Kimberly-Clark deal); stale-price guard added 4 Nov.
- 3 Nov: earnings dated the day before the scan showed "-1 days" (fixed 4 Nov in the tranche check; the scan lists already hide past dates).

- 4 Nov: three random items (KLAC, FRT, MRO): stops, 52-week range and off-high consistent. KLAC's low price and -49% off high follow its 10-for-1 split (May 2026); worth a split check in the 52-week high once the y1 return is missing. Found and fixed: UK quote dividend yields 100× too small. Charter's P/E of 2.4 looks odd but matches its collapsed price.
- 4 Nov: trade log (Next up 1) not started; today went on the three data bugs above.
- 6 Nov: NWSA, HLMA, GWW checked: stops (2×ATR), 52-week ranges, off-high and yields consistent; NWSA's -13.4% day follows its 4 Nov results. UK items have no market cap (minor, display only). The quick scan shows META "Fair 75" while the full Research score is "Good entry 84" (quick vs deep scoring, the tranche check uses the full score); fixed 6 Nov midday: the scan now shows "Quick · list 84" and the full score in the detail.
- 5 Nov: NVDA, ALL, MRO, NVR checked: stops (2×ATR), 52-week ranges and yields consistent; NVDA's forward P/E of 12.6 (trailing 25.3) is Yahoo's next-year estimate, plausible given +106% revenue growth. Found and fixed: 1-year return missing for every US stock (251 sessions in a "1y" download). The scan's "-1 days" results date was fixed the same evening.

## Done (recent)
- 6 Nov (afternoon): estimated next results date (Research page and pick check, display only); buy-tier backtest follow-up with FTSE triggers, a 60/40 blend and ACWI (research log).
- 6 Nov (midday): display-only "Entry view" (proposed Entry rule with 12-1 month momentum); fix: scan-only filters showed on Your list.
- 6 Nov (midday): swing paper-trade view on the Research page (market and setup filters, R curve before and after costs).
- 6 Nov (midday): buy-tier and dip-reserve backtest (research log); scan shows the full list score next to a quick score.
- 6 Nov: dip study (pullback rule and 4% days, 97 years); smart-money step 1 (13F parser and fetcher, source blocked).
- 5 Nov (night): Entry-pillar test on ten years of our own data (research log).
- 5 Nov (night): sector-relative valuation as a display-only "Peer view" (sector medians in the scan, cyclical flag and cap, would-be score and verdict).
- 5 Nov (late): swing's 10% moves to the core (Douglas: "you decide for now"); targets now 70/15/15, swing paper only.
- 5 Nov (evening): swing retune backtest (no variant beats random entry after costs; swing stays on paper); scan results-date fix (45 stocks showed "-1 days"); "Reported" label on the Research page.
- 5 Nov: trade log with plan adherence (browser only); 1-year return fix for US stocks.
- 4 Nov: UK dividend yield fix, "-1 days" results label in the tranche check, stale-price guard.
- 3 Nov: investment trusts are no longer scored as companies (PCT had topped the scan at 96).
- 2 Nov: tranche check uses the latest results date when no next date is published (HSBC, Newmont).
- 1 Nov: plan-this-week panel, pullback-rule alert, private pots and goal panel, swing paper-trading log and backtest, pinned-price (takeover) detection and stop floor. See CHANGELOG.

## Later
- Performance (measured 6 Nov): scan.json is 1.3 MB but about 190 KB gzipped (Pages gzips), and the Research page only fetches it when the Index scan tab is opened; research.json is 21 KB gzipped. Not worth a file split yet. If it grows: move `longTerm.pillars[].items[].why` (one fixed text per metric) and `sectorValue.note` into the page.
- More indices (Euro Stoxx 50, Nasdaq 100) in the scanner.
- Insider buying and short interest signals (needs a free source).
- Price alerts for individual stocks set from the Research page.
