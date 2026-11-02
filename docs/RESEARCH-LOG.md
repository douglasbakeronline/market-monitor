# Research log

Dated findings that shape the rules. Newest first. Each entry: question, finding, strength of evidence, sources, implications.

## 2026-11-02: Should valuation be scored against sector peers, and how should cyclicals be treated?
- Question: the scan's top long-term score today is Sandisk (92, forward P/E about 4), with Western Digital (84, P/E about 9) close behind. Fixed P/E bands reward any low P/E. Is a low P/E a reliable signal for cyclical companies, and is a sector-relative score better?
- Finding: (1) Value measured within an industry predicts returns better than value measured across the whole market (Asness, Porter and Stevens, 1963 to 1998, all US stocks). Morningstar found the cheapest-industry tilt itself added nothing (-0.32% a year, 1966 to 2016) while stock-level value earned +2.36% a year: the return comes from picking cheap stocks within sectors, and industry bets mostly add risk. (2) For cyclicals, a low P/E often marks peak earnings: McKinsey found consensus forecasts for 36 US cyclicals kept trending up whether the company was at a peak or a trough, and prices track a blend of current and normalised earnings. Normalised (mid-cycle) earnings are the recommended anchor.
- Strength: Moderate to strong for sector-relative value (several decades, replicated, used by index and quant providers). Moderate for the cyclical point (smaller sample, but consistent with long practitioner experience).
- Sources: [Asness, Porter and Stevens, "Predicting Stock Returns Using Industry-Relative Firm Characteristics" (AQR working paper, 2000)](https://www.aqr.com/Insights/Research/Working-Paper/Predicting-Stock-Returns-Using-IndustryRelative-Firm-Characteristics); [Bryan and McCullough, "The Impact of Industry Tilts on Factor Performance" (Morningstar, 2017)](https://www.morningstar.co.uk/static/UploadManager/Assets/The_Impact_of_Industry_Tilts_on_Factor_Performance.pdf); [McKinsey, "How to value cyclical companies"](https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/how-to-value-cyclical-companies).
- Implication: supports roadmap item "sector-relative valuation". Proposed (not yet applied): score P/E and EV/EBITDA against the scan's sector median; for cyclical industries (memory and storage chips, miners, chemicals and fertilisers, autos, energy, airlines) add a "Cyclical: low P/E may be peak earnings" note and cap the value pillar so a P/E alone cannot make a "Good entry". This would change verdicts, which feed the pick tranche check (Newmont and CF Industries are cyclicals), so it needs Douglas's OK before it affects the plan check.

## 2026-11-01: Do the swing rules have an edge?
- Question: before real money goes into the swing pot on 16 Nov, would the agreed swing rules (scanner "Setup", entry next open, 2×ATR stop, 2R target, 20-session exit) have made money over the past year?
- Finding: No edge. 3,804 closed trades on S&P 500 and FTSE 100 stocks (Nov 2025 to Oct 2026): 42% winners, average **+0.04R** per trade (US +0.06R, UK -0.02R). A baseline that enters on any day with the same stops and targets did better: +0.10R. Higher setup scores helped a little (75+: +0.14R on 589 trades, still barely above the baseline). Results swung by month from -0.54R (Mar 2026) to +0.53R (Feb 2026). Trading 212's 0.15% FX fee each way on US shares costs roughly 0.05R to 0.1R per trade at typical stop widths, which wipes out the edge.
- Strength: Moderate. Large sample, but one year of a mostly rising market, today's index members only (survivorship), overlapping trades, and earnings dates not filtered historically.
- Sources: own backtest, `tools/swing-backtest.mjs`, run 1 Nov 2026 on Yahoo daily data.
- Implication: recommend keeping the swing pot on paper (live paper log started 30 Oct) rather than funding it on 16 Nov; revisit after 3 months of live paper results, or retune the setups (for example only score 75+ in an uptrend) and re-test. Decision for Douglas.

## 2026-10-30: Is the run-up to the midterms the strongest period for the S&P 500?
- Finding: No. Since 1948 the S&P 500 averaged ~4.6% in midterm years vs ~11.2% in the other three years; the strong window is the 12 months after the midterms (~13.9% average vs ~5.8% for comparable periods). 2026 has not followed the usual midterm weakness.
- Strength: Weak to moderate. Long record but only ~19 cycles; averages hide big variation; widely known, so may be partly priced in.
- Sources: Oppenheimer, "The Midterm Election Effect on Markets" (2026); Bank of America via investinglive.
- Implication: No rule change. Do not time the core on it. Mention as context in summaries around 3 Nov 2026.

## 2026-10-30: Lump sum or drip-feed the new money?
- Finding: Lump sum beat 12-month drip-feeding about two-thirds of the time in the UK and US; average gap ~2.2% (UK). Drip-feeding wins in steady falls and helps nervous investors stay invested.
- Strength: Strong (Vanguard study across decades and countries, replicated elsewhere).
- Sources: Vanguard, "Cost averaging: invest now or temporarily hold your cash?"; Monevator, "Lump sum investing versus drip feeding".
- Implication: Half the core now, the rest over three months (short stagger, not 12).

## 2026-10-30: Copying politicians and investors (Autopilot, NANC/KRUZ)
- Finding: Autopilot mirrors disclosed trades of US politicians (STOCK Act, up to 45 days late) and fund managers (13F, quarterly, up to 45 days after quarter end). Headline returns quoted are of the politicians' disclosed trades, not of app users. UK availability not confirmed. NANC beat the S&P in the year to June 2024 largely via one stock (Nvidia).
- Strength: Weak. Short histories, lags, survivorship and concentration effects.
- Sources: CGAA overview of Autopilot; etf.com NANC vs KRUZ; Gray News on 2026 Congress trading bills.
- Implication: Build as a tracked tie-breaker signal only (roadmap), drop after a year if it does not beat the S&P.
