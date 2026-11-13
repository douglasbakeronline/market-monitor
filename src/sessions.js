// Trading sessions for the short-term pot's orders (13 Nov 2026). The pot's
// orders are "at the next open" after the signal close, but the Dashboard kept
// showing "Buy ... at the next open" all day after that open had passed (13
// Nov, 19:30: Burberry, Abbott, Amcor and IFF, bought at that morning's opens),
// until the evening scan replaced the list. orderTiming() says whether the
// open is still ahead, today, or already passed, so the page can say so.
// Browser-safe (used by index.html via src/today.js).
import { partsIn, addDays } from "./util.js";

// Full-day closures only (half days still open). NYSE and London Stock
// Exchange published calendars. Refresh each year: a test fails once either
// list ends less than two months ahead.
export const HOLIDAYS = {
  US: {
    until: "2027-12-31",
    days: ["2026-11-26", "2026-12-25",
      "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"],
  },
  UK: {
    until: "2027-12-31",
    days: ["2026-12-25", "2026-12-28",
      "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28"],
  },
};
// Opening time and zone per market (European names trade on London's clock
// closely enough for the pot; it holds none today).
const OPEN = { US: { tz: "America/New_York", min: 9 * 60 + 30 }, UK: { tz: "Europe/London", min: 8 * 60 } };
const mkt = (m) => (m === "US" ? "US" : "UK");

const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const isSession = (date, market) => {
  const wd = weekday(date);
  return wd !== 0 && wd !== 6 && !HOLIDAYS[mkt(market)].days.includes(date);
};

// The first session strictly after `date`.
export function nextSession(date, market) {
  let d = addDays(date, 1);
  for (let k = 0; k < 10 && !isSession(d, market); k++) d = addDays(d, 1);
  return d;
}

// signalDate: the close the order came from. state: "next" (its open is on a
// later day), "today" (later today), "passed" (the open has happened).
export function orderTiming(signalDate, market, now = new Date()) {
  if (!signalDate) return null;
  const due = nextSession(signalDate, market);
  const o = OPEN[mkt(market)], p = partsIn(o.tz, now);
  const state = p.date < due ? "next" : p.date > due ? "passed" : p.min < o.min ? "today" : "passed";
  return { due, state };
}
