// Works out the next scheduled slot (see CONFIG.slots), DST-aware.
import { CONFIG } from "./config.js";
import { partsIn, zonedTime, addDays } from "./util.js";

export function slotInstants(now = new Date(), slots = CONFIG.slots, daysAhead = 8) {
  const out = [];
  for (const s of slots) {
    const today = partsIn(s.tz, now).date;
    for (let d = -1; d <= daysAhead; d++) {
      const date = addDays(today, d);
      const at = zonedTime(s.tz, date, s.time);
      const wd = partsIn(s.tz, at).weekday;
      if (s.days.includes(wd)) out.push({ ...s, date, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Next slot strictly after now (+ a small margin).
export function nextSlot(now = new Date(), slots = CONFIG.slots) {
  const t = now.getTime() + 30_000;
  const s = slotInstants(now, slots).find((x) => x.at.getTime() > t);
  return s ? { ...s, waitSec: Math.round((s.at.getTime() - now.getTime()) / 1000) } : null;
}

export const slotById = (id) => CONFIG.slots.find((s) => s.id === id) || null;
