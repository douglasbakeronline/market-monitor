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

// The open as a phrase for the pot's pushes (13 Nov, late): the 08:15
// fallback push said "at the next open" for UK orders after London's 08:00
// open had passed, and Friday's evening push did not say the open was Monday.
// Returns { state, text }: text reads "at <text>", e.g. "the next open",
// "the Mon 16 Nov open", "today's open (14:30 London)", "today's 08:00 open".
const dmy = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
// London clock time of a market's open on a date (US opens 14:30 London, 13:30
// in the weeks when only one side has moved its clocks).
export function openInLondon(date, market) {
  const o = OPEN[mkt(market)];
  let t = Date.parse(`${date}T12:00:00Z`);
  for (let k = 0; k < 3; k++) { const p = partsIn(o.tz, new Date(t)); t += ((p.date === date ? 0 : p.date < date ? 1440 : -1440) + o.min - p.min) * 6e4; }
  const l = partsIn("Europe/London", new Date(t)).min;
  return `${String(Math.floor(l / 60)).padStart(2, "0")}:${String(l % 60).padStart(2, "0")}`;
}
export function openPhrase(signalDate, market, now) {
  const t = now ? orderTiming(signalDate, market, now) : null;
  if (!t) return { state: "next", text: "the next open" };
  const today = partsIn("Europe/London", now).date, hhmm = openInLondon(t.due, market);
  const onDay = t.due === today ? "today's" : t.due < today ? `the ${dmy(t.due)}` : null;
  if (t.state === "passed") return { state: "passed", due: t.due, text: `${onDay ?? `the ${dmy(t.due)}`} ${hhmm} open` };
  if (t.state === "today" || t.due === today) return { state: "today", due: t.due, text: `today's open (${hhmm} London)` };
  return { state: "next", due: t.due, text: t.due === addDays(today, 1) ? "the next open" : `the ${dmy(t.due)} open` };
}
