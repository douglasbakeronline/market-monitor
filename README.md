# Market Dip Monitor — Setup Guide

A free dashboard plus phone-alert system for contrarian dip buying. Live CNN
Fear & Greed gauge, S&P 500 / FTSE 100 drawdown and last-5-sessions, a movement
chart, a watchlist of your own stocks, and a US/UK movers panel. Phone alerts
fire on buy/greed signals plus a daily summary about 15 minutes after each open.

Everything runs on free tiers. Total setup time is about 20 minutes.

---

## What you need

REQUIRED (one actual download, the rest are free browser accounts):

1. **ntfy** mobile app — the only thing you install.
   - iPhone: Apple App Store, search "ntfy".
   - Android: Google Play, search "ntfy".
2. **A GitHub account** — browser only, no install. Sign up at github.com.
3. **A Financial Modeling Prep account** — browser only, free API key, at
   financialmodelingprep.com. (Skip only if you do not want the movers panel.)

OPTIONAL (only if you later want to edit or test on your own computer):

- **Node.js** version 20 or later (nodejs.org) to run the script locally.
- **Git** (git-scm.com) and a text editor such as **Visual Studio Code**
  (code.visualstudio.com) to edit files locally instead of in the browser.

You do NOT need Node, Git or an editor for the standard setup below. GitHub runs
the code for you and you upload files through its website.

---

## Phase 1 — Phone notifications (3 minutes)

1. Install the **ntfy** app (see above) and open it.
2. Decide on a private "topic" name. It is the only thing protecting your
   alerts, so make it long and unguessable, for example `dbaker-mkt-7h2q9x`.
   Write it down exactly.
3. In the ntfy app, tap the "+" to add a subscription, type that exact topic
   name, and subscribe. Allow notifications if prompted.
4. Test delivery. On a phone or computer, open any web browser and visit:
   `https://ntfy.sh/dbaker-mkt-7h2q9x/publish?message=test`
   (use your topic name). Your phone should buzz within a couple of seconds.
   Do not continue until this works.

## Phase 2 — Create the repository (4 minutes)

5. Go to github.com and sign in. Click the "+" top-right, then "New repository".
6. Name it `market-monitor`. Set visibility to **Public** (required for the free
   dashboard URL; nothing private is stored in the repo). Click
   "Create repository".
7. Upload the code files. There are two parts because of the workflow folder.
   a. On the repo page, click "Add file" then "Upload files". Drag in
      `index.html`, `fear-greed-monitor.js`, and `package.json`. Click
      "Commit changes".
   b. Click "Add file" then "Create new file". In the filename box type exactly:
      `.github/workflows/monitor.yml`
      (the slashes create the folders automatically). Open `monitor.yml` from
      this download, copy all of it into the editor, then "Commit changes".

## Phase 3 — Add your secrets (3 minutes)

8. Get a free Financial Modeling Prep API key: sign up at
   financialmodelingprep.com, open your Dashboard, copy the API key.
9. In your GitHub repo go to "Settings" tab → "Secrets and variables" → "Actions"
   → "New repository secret". Add two, one at a time:
   - Name `NTFY_TOPIC`, value = your topic from step 2.
   - Name `FMP_KEY`, value = your FMP key from step 8.
10. Still in Settings, open "Actions" → "General". Scroll to "Workflow
    permissions", choose "Read and write permissions", and Save.

## Phase 4 — First run (2 minutes)

11. Open the "Actions" tab. If prompted, click to enable workflows. Click
    "Market dip monitor" on the left, then "Run workflow" → "Run workflow".
12. Wait under a minute, click into the run, open the "check" job, expand
    "Run monitor". You should see a line like
    `F&G 28 (fear) | S&P -4.2% off peak`. This also creates `data.json`.

## Phase 5 — Publish the dashboard URL (3 minutes)

13. Go to "Settings" → "Pages". Under "Build and deployment", set Source to
    "Deploy from a branch", choose branch `main` and folder `/ (root)`, Save.
14. Wait about a minute, refresh the Pages settings page, and copy the URL it
    shows: `https://<your-username>.github.io/market-monitor/`.
15. Open it on your phone and add it to your home screen so it opens like an app.

Done. It now runs itself every weekday, pushes alerts, and the dashboard pulls
the live Fear & Greed figure on every refresh.

---

## How notifications time themselves

The workflow runs a few times around each open (in UTC). The script is
timezone-aware and sends the daily summary once per market per day, about 15
minutes after the UK open (08:15 London) and the US open (09:45 New York).
Daylight saving is handled automatically, so you never touch the schedule.

Buy and greed signal alerts fire whenever the condition is newly met, regardless
of time, and are de-duplicated so you are not pinged repeatedly for the same
event.

## Editing your watchlist

Open `fear-greed-monitor.js`, find `CONFIG.watchlist` near the top, and edit the
list. Symbols use Stooq format: US tickers end `.us` (e.g. `nvda.us`), UK tickers
end `.uk` (e.g. `shel.uk`). Commit the change and the dashboard follows on the
next run.

## Testing an alert immediately (optional, needs Node.js)

If you installed Node.js, from the project folder run:
`FORCE_SUMMARY=1 NTFY_TOPIC=your-topic node fear-greed-monitor.js`
This sends a summary push straight away so you can confirm the format.

## Notes and limits

- The Fear & Greed gauge, comparison cards and movement chart are pulled LIVE
  from CNN on each page load. The price panels, watchlist and movers refresh on
  the schedule, not live.
- CNN publishes one Fear & Greed value per day, so the index open/close in the
  5-sessions panel fills in live from the day you deploy and cannot be backdated.
- UK movers usually need a paid FMP plan; the US list works on the free tier.
- Stooq quotes UK shares in pence, so a £112.40 share shows as 11240.
- This is a personal tracker, not financial advice.
