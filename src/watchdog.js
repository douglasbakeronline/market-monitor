// Chain watchdog: has the monitor saved data for every slot it should have run?
// The monitor cannot report its own silence, so a separate workflow checks
// data.json's `updated` against CONFIG.slots and restarts the chain if needed.
import { CONFIG } from "./config.js";
import { partsIn, zonedTime, addDays } from "./util.js";

// Slot instants from `daysBack` days ago up to tomorrow (covers a weekend gap).
export function pastSlots(now = new Date(), slots = CONFIG.slots, daysBack = 4) {
  const out = [];
  for (const s of slots) {
    const today = partsIn(s.tz, now).date;
    for (let d = -daysBack; d <= 1; d++) {
      const date = addDays(today, d);
      const at = zonedTime(s.tz, date, s.time);
      if (s.days.includes(partsIn(s.tz, at).weekday)) out.push({ id: s.id, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ok: data was saved at or after the last slot that is more than `graceMin` old.
// missed: the slots due since the last save (oldest first).
export function chainHealth(updated, now = new Date(), { slots = CONFIG.slots, graceMin = 45, toleranceMin = 5 } = {}) {
  const u = Date.parse(updated);
  const cutoff = now.getTime() - graceMin * 60e3;
  const due = pastSlots(now, slots).filter((s) => s.at.getTime() <= cutoff);
  const lastDue = due.at(-1) ?? null;
  if (!Number.isFinite(u)) return { ok: false, updated: null, lastDue, missed: lastDue ? [lastDue] : [], hoursSince: null };
  const missed = due.filter((s) => s.at.getTime() - toleranceMin * 60e3 > u);
  return { ok: missed.length === 0, updated, lastDue, missed, hoursSince: (now.getTime() - u) / 3600e3 };
}

const london = (d) => new Date(d).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const span = (h) => (h == null ? "unknown" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.round(h / 24)} days`);

// Push text for a stale chain. `active`: a Market monitor run is running or queued.
export function watchdogMessage(h, { active = false, restarted = false } = {}) {
  const ids = h.missed.map((s) => s.id);
  const list = ids.length > 4 ? `${ids.slice(0, 3).join(", ")} and ${ids.length - 3} more` : ids.join(", ");
  const last = h.updated ? `Last saved ${span(h.hoursSince)} ago (${london(h.updated)} London)` : "No save time in data.json";
  const action = restarted ? "No run was active, so the watchdog started one."
    : active ? "A run is active but has not saved data: check the Market monitor run on GitHub Actions."
    : "No run is active and the restart failed: start Market monitor by hand on GitHub Actions.";
  return { title: "Monitor chain: missed a slot", body: `${last}; missed ${list}. ${action} Alerts may not have been sent meanwhile.`, priority: "high", tags: "warning" };
}
