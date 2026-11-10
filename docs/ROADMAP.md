# Roadmap

Working plan for Market Monitor. Claude develops this autonomously (Douglas granted full freedom on 29 Oct 2026) and reports weekly via a PDF review deck. Keep this file current: move items to the changelog when shipped.

## Principles
- Never break the alert chain. Test (`npm test`), dry-run on the `dryrun` branch with real data, lint workflows (`actionlint`), then push to main.
- Every number on screen should explain itself. Prefer fewer, clearer signals over more noise.
- No paid services. No secrets in the repo (it's public).

## Waiting on Douglas
- **Hold a pick tranche after weak results and a falling price? (10 Nov)** Swing lab round 4: in the past year, results in the bottom fifth of EPS surprise that also fell 2%+ on the day trailed the S&P 500 by 3.6 points over 60 sessions (other falls +0.5). Weak evidence (one year). Proposal: when a pick shows that flag on the Research page, hold its next tranche until its next results. HSBC is flagged now (Meta too, but its miss was a tax one-off). OK, or keep it display-only?
- OK to keep the five pick names in the public repo (they drive the Dashboard tranche check)? Alternative: load the plan from the browser like the pots panel.
- His own research list (Research page still uses a placeholder, now including the picks and bench).
- Optional `FINNHUB_KEY` secret.
- Whether to keep the trim signal (on, strict). *Tested 7 Nov afternoon (research log):* it does not warn of weaker markets (the year after a signal returned more than an average year, with fewer 10% falls), and selling to cash at it cost a little. Keep it as a rebalance-only reminder (no change), or switch it off? Same test of the greed "stop adding" alert: no warning either, and a short pause in new money made no difference. Proposed: reword greed and "Euphoric" to "no need to add extra money now; keep scheduled purchases going" (drop "build cash for the next dip"). OK?
- **Add the `SEC_CONTACT` secret (6 Nov), now optional (8 Nov: 13f.info covers the same filings):** Douglas agreed to use his email for SEC. If he wants EDGAR as the first source, he adds it himself: repo Settings, Secrets and variables, Actions, New repository secret, name `SEC_CONTACT` (Claude cannot set secrets).
- **Picks pot scorecard (10 Nov research log):** (a) a yearly picks-vs-VWRP scorecard at the Sunday review from Nov 2027; (b) if the pot has trailed VWRP after three years (Nov 2029), fold it into the core. OK to add both to the strategy notes?
- **REITs on cash flow, not P/E (10 Nov):** a display-only "REIT view" now shows price / operating cash flow against fully scored REITs (a stand-in for P/FFO). OK to use it in place of P/E in REITs' Value pillar? It would affect VICI (a pick). Nothing changes until agreed.
- **Dip reserve and the proposed 2027 cash-interest charge (research log 10 Nov):** if the 22% charge on interest from cash in a stocks and shares ISA goes ahead from 6 Apr 2027, should the reserve sit in a money market fund inside the ISA instead of cash? Check the final rules and Trading 212's options first (Claude can research this in early 2027).
- Delete leftover branch `probe` (`dryrun` is reused for testing; keep it).

## Next up (in priority order)
1. **Smart-money signal (Autopilot as reference):** Congress disclosures plus 13F holdings of a few long-term managers as a tracked tie-breaker tag on Research and scan pages, scored in the track record like any other signal. *Step 1 done 6 Nov* (parser, fetcher). *Step 2 done 8 Nov:* 13f.info fallback (SEC still blocks without `SEC_CONTACT`), weekly refresh in scan.yml (Monday nights, own step and commit), display-only "Smart money" note on scan and Research items (positions of 1%+ of a manager's portfolio, or sold out). First real refresh landed 8 Nov (322 holdings, all mapped). Track-record event (kind `smart`, Research list only, new or added positions, silent baseline) and a scan filter chip shipped 8 Nov. *Backtest 8 Nov (research log):* five years of the managers' new or added positions showed no edge, so the tag stays display-only and the note says so. Next: (a) on Tue 17 Nov check the Q3 2026 filings came in and that `smart` events were logged for list stocks with new or added positions; (b) scan-wide `smart` events: deprioritised after the backtest (adds ~70 symbols' prices to the monitor run for a signal with no tested edge); (c) Congress disclosures (low priority after the backtest; the sandbox cannot reach disclosures-clerk.house.gov, so build and test on the runners): House PTRs come as a yearly ZIP index (disclosures-clerk.house.gov, reachable from the runners) plus one PDF per report, so parsing needs PDF text extraction; the old house/senate-stock-watcher S3 feeds now return 403. *Traps:* 13f.info has no published API, so keep it to a few requests a week; Pershing's newest filing there was Q1 2026 on 8 Nov (check whether Q2 is filed under another form); do not use a browser user agent on SEC (it works but sidesteps their contact rule).
2. **Scoring follow-ups (live since 10 Nov):** (a) remove the "Rule change" note and `ruleChange`/`ruleChanges` once a few weeks have passed (say from 1 Dec); (b) EV/EBITDA still uses fixed bands (only the ~100 deepened and research-list stocks have it). *Step 1 done 10 Nov:* rotating peer sample (`src/evSample.js`, `data/ev-sample.json`, 120 a night) with display-only medians once 60% of the universe is fresh. Next: on Fri 13 Nov check `scan.json` `evSample.ready` is true and the Peers notes read sensibly; then propose to Douglas scoring EV/EBITDA against the sector median like P/E (a rule change: bump `SCORING_VERSION`). *Trap:* deepened stocks refresh themselves nightly and research-list stocks are not in the sample unless they are index members; (c) REITs: display-only REIT view shipped 10 Nov; using it in the score waits on Douglas. *Trap:* the research state re-baselines long-term verdicts silently when `SCORING_VERSION` changes, and the scan's "new" list does the same; bump it for any future rule change.
3. **Reserve drip follow-ups:** the first drip is Mon 7 Dec. Check that the Dashboard and Monday push show it, and that a logged "Reserve drip into core" trade counts in the adherence list.
4. **Track-record page:** *slices 1 and 2 done (7 and 8 Nov):* per-kind table, then a collapsed detail panel (by market against each stock's home index, by score band, 1 week / 1 month / 3 months side by side) and a digest line per type. All hold back until 5 scored per group. Headline, per-kind table and recent list switched to the home index 10 Nov. Next (from about December, once groups fill): review whether any signal type earns or loses its place.
5. **Trade log follow-up (needs Douglas):** the Monday playback cannot see "Not logged" items because the log lives only in his browser. Options: he exports the log to the private project notes now and then, or accept the Dashboard card as the reminder. Dip tiers in adherence and the pots fill shipped 6 Nov evening.
6. **Euro Stoxx 50 follow-ups:** (a) done 6 Nov night (per-region peer medians). (b) Check each European name is on Trading 212 (cannot be checked from here; ask Douglas or note it on the page if a name is missing). (c) If European swing setups are ever paper-traded, extend `costR()` in `src/swingRetune.js` (FX fee as for US) first.

## Data notes (spot checks)
- 10 Nov (daily): WDC, SNDK, WAB checked: off-high, stops (2×ATR) consistent with price and ATR. WDC's 0.27% yield looks about double its quarterly payout over today's price (deep stocks use Yahoo's trailing yield, likely measured at a lower average price); display only, watch. WAB's next results estimate (20 Jan) is early, as Q4 usually lands mid-February: the safe side for the 7-day rule.
- 10 Nov (daily run): CL, SGRO.L, GAW.L checked: off-high, stops (2×ATR), 52-week ranges and yields consistent; Games Workshop is 30% off its high, real per its range. Price series are only kept for deep-scored items (by design, 107 of 662).
- 10 Nov: RMS.PA, GNRC, MAR checked: off-high, stops (2×ATR) and yields consistent (Generac pays none). Hermès is 41% off its high, real per its 52-week range. Noted: 13 UK and European names (Hermès, L'Oréal, Unilever, Safran...) have a stale latest-results date from February, so the estimate rolls forward a quarter at a time and lands in mid-November, flagged "looks stale"; most actually report full-year results in February. Kept: the early estimate is the safe side for the 7-day rule, and none is a pick.
- 9 Nov: ENEL.MI, TEL, MSFT checked: off-high, stops (2×ATR) consistent. Found and fixed: quick-scan dividend yields (Enel 2.7% for about 5.4%, Sanofi 0%); the scan now uses Yahoo's forward yield outside London.
- 9 Nov: HPE, PPG, ARES checked: off-high, stops (2×ATR) and dividend yields consistent with their prices and known payouts. HPE's -37% month is large but consistent with its own 52-week range. Ares shows a P/E of 19.2, well below its usual GAAP trailing figure; probably Yahoo's forward or adjusted P/E (display only; watch if more asset managers look this cheap).
- 8 Nov: LLOY.L, MU, SAP.DE checked: off-high, 52-week ranges and stops (2×ATR) consistent. MU's forward P/E of 3.3 (trailing 9.3) follows +379% revenue growth in a memory upcycle: real, but the classic cyclical-peak trap; MU tops the scan (93) partly on it; the proposed cyclical cap (waiting on Douglas) already flags it and would score it 81, still Good entry.
- 3 Nov: stops (2×ATR), P/E and yields checked on WDC, TMUS, UAL: consistent. Yahoo's latest-results date is stale for some UK names (Unilever shows Feb 2026); addressed 6 Nov afternoon with an estimated next date flagged "looks stale" (8 scan stocks). Kenvue's price stopped on 30 Oct (likely delisted after the Kimberly-Clark deal); stale-price guard added 4 Nov.
- 3 Nov: earnings dated the day before the scan showed "-1 days" (fixed 4 Nov in the tranche check; the scan lists already hide past dates).

- 4 Nov: three random items (KLAC, FRT, MRO): stops, 52-week range and off-high consistent. KLAC's low price and -49% off high follow its 10-for-1 split; checked 6 Nov afternoon: Yahoo's bars are split-adjusted (split 12 Jun, high 302 on 30 Jun), so the fall is real; a split guard now covers unadjusted bars. Found and fixed: UK quote dividend yields 100× too small. Charter's P/E of 2.4 looks odd but matches its collapsed price.
- 4 Nov: trade log (Next up 1) not started; today went on the three data bugs above.
- 6 Nov: NWSA, HLMA, GWW checked: stops (2×ATR), 52-week ranges, off-high and yields consistent; NWSA's -13.4% day follows its 4 Nov results. UK items have no market cap (minor, display only). The quick scan shows META "Fair 75" while the full Research score is "Good entry 84" (quick vs deep scoring, the tranche check uses the full score); fixed 6 Nov midday: the scan now shows "Quick · list 84" and the full score in the detail.
- 5 Nov: NVDA, ALL, MRO, NVR checked: stops (2×ATR), 52-week ranges and yields consistent; NVDA's forward P/E of 12.6 (trailing 25.3) is Yahoo's next-year estimate, plausible given +106% revenue growth. Found and fixed: 1-year return missing for every US stock (251 sessions in a "1y" download). The scan's "-1 days" results date was fixed the same evening.

## Done (recent)
- 10 Nov (morning): swing book round 2: random-choice benchmark, value vs S&P chart, push on orders and closes, why each setup fired.
- 10 Nov (daily run): results record (beats of last 4, next forecast) and weak-results flag in the tranche check and Monday push.
- 10 Nov (daily run): Swing lab round 4 (earnings surprise; fails the bar, weak-and-falling pattern shown), nightly "Last results" check for picks, bench and movers; Trading 212 import shows fees as a share of money traded.
- 10 Nov (daily run): Swing lab round 3: sector rotation by momentum, survivorship-free (fails; trend filter is insurance, not an edge).
- 10 Nov (morning): Claude's swing book (paper), four slots under the funded swing rules, with S&P comparison and next-session orders; persist.sh skips missing files.
- 10 Nov (daily run): Swing lab round 2: drift by holding period with a down-day placebo (mostly a volume effect; no wait-after-bad-results rule for picks); live test now tracks both directions to 60 sessions.
- 10 Nov (morning): ISA allowance tracker (subscriptions, dividends, interest from the Trading 212 import).
- 10 Nov (morning): sell signals tested (none helps a holder) and shown display-only with their verdict; trailing-stop level per stock.
- 10 Nov (daily run): Swing lab: three published short-term effects backtested (none clears the bar; post-results drift closest); drift paper-traded live; Research page card.
- 10 Nov (morning): This week's money check on the Dashboard (plan verdict, conditions, buy-now-or-wait study).
- 10 Nov (daily): EV/EBITDA peer sample, display only (step 1 of Scoring follow-ups b).
- 10 Nov (daily run): goal odds in today's money and a "what moves the odds" line (£100 more a month, 2 more years).
- 10 Nov (morning): goal odds in the pots panel (block-bootstrap simulation, fan chart, History and Cautious, history check).
- 10 Nov (morning): picks line in the Monday push and digest; weekly score change in the tranche check.
- 10 Nov (morning): Trading 212 CSV import into the trade log; edit a logged trade; pots filled at today's value from the log.
- 10 Nov (morning): picks line in the Sunday digest; Near good entry badge.
- 10 Nov (morning): push line when a pick reports; Picks & bench filter and badges on the Research page.
- 10 Nov (morning): bench badges and push line; notes not counted as actions; pick sizes at today's price (optional price paid in the trade log); REIT view (display only).
- 10 Nov (morning): look-through of the biggest single companies in the pots panel.
- 10 Nov (morning): research rebuilds itself after a scoring rule change (`scoringVersion` in research.json).
- 10 Nov (morning): track record headline and tables against each signal's home index.
- 10 Nov (morning): reasons for every "not a good entry" (tranche check, Research page); "Near good entry" filter; 10-day flicker guard on research alerts and events.
- 10 Nov (early): scoring changes live (value against sector peers with the cyclical cap; Entry without extra credit for deep discounts, plus momentum); monthly reserve drip into the core in the plan, pots panel and trade log.
- 10 Nov (early): pick tranche check shows each pick's size from the trade log; "Full" at the 3% maximum.
- 10 Nov (early): pots panel scales the core pot by VWRP's move since the values were saved.
- 10 Nov (early): Key dates cover VWRP's top 20 holdings (TSMC, Samsung, SK hynix via extra quotes); holdings under 1% only in their results week.
- 10 Nov (night): rebalancing rule agreed by Douglas and made live: strategy notes, pots panel ("Agreed 10 Nov", rebalances in the last 12 months, act-now note), Sunday digest reminder.
- 9 Nov (late): rebalancing view in the pots panel (new money to reach targets, pick sizes at cost vs the 3% maximum and the proposed 5% ceiling; display only).
- 9 Nov (evening): results dates of VWRP's biggest holdings in Key dates; Strategy (MSTR) shown as a holding company, not scored.
- 9 Nov (afternoon): fix: Index scan save step failed on Mondays (smart-money file left unstaged; persist.sh now autostashes). Verified 9 Nov 19:54: a Monday run with the smart-money refresh passed.
- 9 Nov (afternoon): Nasdaq 100 names the other indices miss join the index scan (13 on 9 Nov), with their own filter.
- 9 Nov (midday): fix: quick-scan dividend yields (forward yield outside London).
- 9 Nov (midday): price alerts for individual stocks (price-alerts.json, Dashboard card and file builder, phone alert once per crossing); "Set a price alert" link on every Research and scan item; digest line.
- 9 Nov (morning): pullback-trigger source test (VWRP vs S&P/FTSE: no difference, rule unchanged); rebalancing research (research log).
- 8 Nov (evening): core fund (VWRP) in pounds on the Dashboard and in the digest; world tiles show off-high with Correction and Bear market tags.
- 8 Nov (afternoon): smart-money backtest (no edge; research log); the Smart money note says so.
- 8 Nov (morning): smart-money tags from 13F filings via 13f.info (display only; SEC fallback); smart-money events in the track record; scan filter.
- 8 Nov (morning): track record by market, score band and time held; digest line per signal type.
- 7 Nov (afternoon): trim-signal and greed-alert backtests (research log).
- 7 Nov (morning): "Both together" view of the two scoring proposals; track record by signal type.
- 6 Nov (night): peer view compares with regional sector medians (US vs Europe).
- 6 Nov (evening): Euro Stoxx 50 in the index scan (650 companies).
- 6 Nov (evening): dip tiers in the trade-log adherence list; pots form can fill from the log.
- 6 Nov (afternoon): scan keeps past results dates so estimates learn each company's gap.
- 6 Nov (afternoon): split guard on price history (KLAC's fall checked: real, not a split).
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
- Swing book: once 30+ book trades have closed, judge it against the random-choice books (live on the card) and every setup; if it is no better than luck, try another ranking (e.g. the swing lab's drift signals) as a second paper book rather than changing this one.
- Swing lab follow-ups: (a) once each side of the live volume-shock test (history/swing-lab.json, up and down) has 30+ trades closed at 60 sessions (about early spring 2027), report drift = up minus down vs the index to Douglas; round 2 (10 Nov) found it +0.1 to +0.8 points in the backtest once matched; (b) drift on Euro Stoxx 50 names needs a backtest first (costs as US); (c) a fourth pre-registered test could use real results dates and the size of the earnings surprise (needs a free source of estimates); (d) the backtests rerun with `node tools/swing-lab.mjs`, `tools/drift-study.mjs` or `tools/sector-rotation.mjs` on a dry-run branch (`dryrun-lab` has the workflow); (f) rerun `tools/surprise-study.mjs` each quarter (after each results season) so the surprise evidence grows beyond one year; decide then whether the "weak results and a falling price" proposal holds; (e) stop adding variants to the same data: three rounds found nothing, and more tries on the same history mostly find noise.
- Money check: refresh `data/wait-study.json` once a year (`node tools/wait-study.mjs` on the dryrun runner).
- Goal odds: refresh `data/returns.json` once a year (`node tools/returns.mjs` on the dryrun runner; Yahoo is blocked from the sandbox). "Today's money" switch and the "what moves the odds" line shipped 10 Nov (daily run). Possible next: let the monthly top-up rise with inflation in today's-money mode (a toggle), if Douglas plans to raise it with pay.
- Performance (measured 6 Nov): scan.json is 1.3 MB but about 190 KB gzipped (Pages gzips), and the Research page only fetches it when the Index scan tab is opened; research.json is 21 KB gzipped. Not worth a file split yet. If it grows: move `longTerm.pillars[].items[].why` (one fixed text per metric) and `sectorValue.note` into the page.
- Insider buying and short interest signals (needs a free source).
- Nasdaq 100 follow-up: Strategy (MSTR) is now a "Holding company" (not scored, 9 Nov); add others to `ASSET_HOLDERS` in `src/research.js` if they join an index. SpaceX (SPCX) is newly listed and scored like any company (only 36% data coverage on 9 Nov). Wikipedia moved the component table to "List of NASDAQ-100 companies" (the main page has none); the scan falls back to its cache if it moves again.
- Core holdings weights (`PLAN.coreHoldings` in `src/plan.js`) are from VWRP's 31 Jul 2026 holdings: refresh each quarter (stockanalysis.com/quote/lon/VWRP/holdings lists them). Checked 10 Nov: the page still shows 31 Jul. TSMC, Samsung and SK hynix dates come from extra quotes in the scan (`extra: true`).
- Price alerts follow-up: log reached levels in the track record if Douglas uses them.
