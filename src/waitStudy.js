// "Buy now or wait?" study for the Dashboard's money check (display only).
// From every past day when the index sat in the same distance-from-high band as
// today, what happened next, and what waiting for the pullback rule (-5%)
// would have done: how often the dip came within the window, what it saved,
// and what waiting cost when it never came. Rules are unchanged by this.
import { drawdowns, stats, fwd } from "./dipStudy.js";

// Bands of distance from the 52-week high, in % (upper bound inclusive):
// "0 to -1", "-1 to -2", ... "-4 to -5". At -5 or below the rule fires anyway.
export const BANDS = [[0, -1], [-1, -2], [-2, -3], [-3, -4], [-4, -5]];
export const bandOf = (dd) => (dd == null || dd <= -5 ? null : BANDS.findIndex(([hi, lo]) => dd <= hi && dd > lo));

// Wait up to `win` bars for the drawdown to reach `trigger` (e.g. -5) and buy at
// that close; if it never does, buy at the end of the window. Saving is the %
// by which the price paid is below today's (negative = waiting cost money).
export function waitOutcome(rows, dd, i, trigger = -5, win = 63) {
  if (i + win >= rows.length) return null;
  for (let k = 1; k <= win; k++) {
    if (dd[i + k] <= trigger) return { hit: true, days: k, saving: (1 - rows[i + k].close / rows[i].close) * 100 };
  }
  return { hit: false, days: win, saving: (1 - rows[i + win].close / rows[i].close) * 100 };
}

const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const med = (xs) => stats(xs).median;

export function waitStudy(rows, { warm = 252, trigger = -5, win = 63, horizons = { w1: 5, m1: 21, m3: 63, m12: 252 } } = {}) {
  const dd = drawdowns(rows);
  const all = { fwd: {} };
  for (const [k, h] of Object.entries(horizons)) all.fwd[k] = stats(rows.map((_, i) => (i >= warm ? fwd(rows, i, h) : null)).filter((x) => x != null));
  const bands = BANDS.map(([hi, lo], b) => {
    const idx = [];
    for (let i = warm; i < rows.length; i++) if (bandOf(dd[i]) === b) idx.push(i);
    const f = Object.fromEntries(Object.entries(horizons).map(([k, h]) => [k, stats(idx.map((i) => fwd(rows, i, h)).filter((x) => x != null))]));
    const w = idx.map((i) => waitOutcome(rows, dd, i, trigger, win)).filter(Boolean);
    const hits = w.filter((x) => x.hit), miss = w.filter((x) => !x.hit);
    return {
      band: `${hi} to ${lo}`, hi, lo, days: idx.length, fwd: f,
      wait: { n: w.length, hitShare: w.length ? Math.round((hits.length / w.length) * 100) : null,
        hitDays: med(hits.map((x) => x.days)), savingIfHit: med(hits.map((x) => x.saving)), savingIfMissed: med(miss.map((x) => x.saving)),
        meanSaving: w.length ? r1(w.reduce((a, x) => a + x.saving, 0) / w.length) : null, betterShare: w.length ? Math.round((w.filter((x) => x.saving > 0).length / w.length) * 100) : null },
    };
  });
  return { from: rows[warm]?.date ?? null, to: rows.at(-1)?.date ?? null, trigger, win, all, bands };
}
