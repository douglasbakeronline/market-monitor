// Small shared helpers: maths, rounding, time zones.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
export const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
export const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Piecewise-linear scale. points = [[x0, y0], [x1, y1], ...] with x ascending.
export function interp(x, points) {
  if (x == null || !Number.isFinite(x)) return null;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

export const mean = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
export const median = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// --- Time zones (DST handled by Intl) ---------------------------------------

// YYYY-MM-DD for an instant in a time zone.
export const dateIn = (tz, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

// Wall-clock parts for an instant in a time zone.
export function partsIn(tz, at = new Date()) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(at);
  const g = (t) => p.find((x) => x.type === t)?.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { date: `${g("year")}-${g("month")}-${g("day")}`, min: +g("hour") * 60 + +g("minute"), weekday: wd };
}

// Offset (minutes) of a zone from UTC at a given instant.
function offsetMin(tz, at) {
  const p = partsIn(tz, at);
  const [y, m, d] = p.date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(p.min / 60), p.min % 60);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

// The UTC instant for a wall-clock time (YYYY-MM-DD, "HH:MM") in a zone.
export function zonedTime(tz, date, hhmm) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMin(tz, new Date(guess)) * 60000;
  t = guess - offsetMin(tz, new Date(t)) * 60000; // second pass settles DST edges
  return new Date(t);
}

export const addDays = (date, n) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// UTC calendar date of a timestamp (CNN stamps each day at 00:00 UTC).
export const utcDate = (t) => new Date(t).toISOString().slice(0, 10);

// ISO week key, e.g. "2026-W44", used to send the weekly digest once.
export function isoWeek(date) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

export const sign = (p, dp = 1) => (p == null ? "n/a" : (p >= 0 ? "+" : "") + Number(p).toFixed(dp) + "%");
