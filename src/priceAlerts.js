// Price alerts for individual stocks. Douglas lists levels in
// price-alerts.json (repo root, edited on GitHub like research-list.json);
// the monitor checks them every slot and pushes one alert per crossing.
// Pure helpers here (no network), so the rules are unit-tested.
//
// Rules:
// - A level fires once when the latest price is at or beyond it.
// - It re-arms only after the price moves back REARM_PCT past the level, so a
//   price wobbling around the line does not alert every slot.
// - Missing or stale prices never fire and never re-arm (like the buy tiers).
// - Prices are in the quote currency: pence for London (.L) shares, as Yahoo
//   and Trading 212 show them.

export const REARM_PCT = 3;
export const STALE_DAYS = 4;
const DAY = 86400000;
const SYMBOL = /^[A-Z0-9^.\-=]{1,15}$/;

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

// Clean the file: returns { alerts, invalid } where each alert has an id per
// direction ("HSBA.L<1000"), so one entry can hold both a floor and a ceiling.
export function parseAlerts(file) {
  const list = Array.isArray(file) ? file : Array.isArray(file?.alerts) ? file.alerts : [];
  const alerts = [], invalid = [];
  for (const raw of list) {
    const symbol = String(raw?.symbol ?? "").trim().toUpperCase();
    const below = num(raw?.below), above = num(raw?.above);
    const okB = Number.isFinite(below) && below > 0, okA = Number.isFinite(above) && above > 0;
    if (!SYMBOL.test(symbol) || (!okB && !okA) || (okB && okA && below >= above)) {
      invalid.push({ symbol: symbol || null, reason: !SYMBOL.test(symbol) ? "bad symbol" : !okB && !okA ? "no level" : "below must be under above" });
      continue;
    }
    const base = { symbol, name: raw.name ? String(raw.name).slice(0, 60) : null, note: raw.note ? String(raw.note).slice(0, 140) : null };
    if (okB) alerts.push({ ...base, id: `${symbol}<${below}`, dir: "below", level: below });
    if (okA) alerts.push({ ...base, id: `${symbol}>${above}`, dir: "above", level: above });
  }
  return { alerts, invalid };
}

const crossed = (a, price) => (a.dir === "below" ? price <= a.level : price >= a.level);
const rearmed = (a, price) => (a.dir === "below" ? price >= a.level * (1 + REARM_PCT / 100) : price <= a.level * (1 - REARM_PCT / 100));

// Latest usable price from daily rows; null if missing or stale.
export function latestPrice(rows, now = new Date()) {
  const last = rows?.at?.(-1);
  if (!last || !Number.isFinite(last.close) || last.close <= 0) return null;
  if (now - Date.parse(`${last.date}T00:00:00Z`) > STALE_DAYS * DAY) return null;
  const prev = rows.length > 1 ? rows.at(-2).close : null;
  return { price: last.close, date: last.date, dayPct: prev ? Math.round((last.close / prev - 1) * 1000) / 10 : null };
}

const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const fmtLevel = (v) => (Number.isInteger(v) ? String(v) : fmt(v)); // a level as written: 90, not 90.0

// state: { [id]: { active, at, price } }. Returns { alerts, state, view }.
// `prices` maps symbol to latestPrice() output (or null).
export function checkAlerts(parsed, prices, prevState = {}, now = new Date()) {
  const state = {}, alerts = [], view = [], fired = [];
  for (const a of parsed.alerts) {
    const p = prices[a.symbol] ?? null;
    const was = prevState[a.id] ?? { active: false };
    let s = { ...was };
    if (p) {
      if (!was.active && crossed(a, p.price)) {
        s = { active: true, at: now.toISOString(), price: p.price };
        fired.push({ id: a.id, symbol: a.symbol, dir: a.dir, level: a.level, price: p.price, at: s.at });
        const label = a.name || a.symbol;
        alerts.push({
          kind: "price", priority: "high", tags: a.dir === "below" ? "chart_with_downwards_trend" : "chart_with_upwards_trend",
          title: `${label} ${a.dir === "below" ? "at or below" : "at or above"} ${fmtLevel(a.level)}`,
          body: [`${label} (${a.symbol}) is ${fmt(p.price)}${p.dayPct == null ? "" : ` (${p.dayPct > 0 ? "+" : ""}${p.dayPct}% today)`}, your alert level was ${fmtLevel(a.level)}.`,
            a.note ? `Your note: ${a.note}` : null,
            "Check the Research page and the plan before acting (no trade within 7 days before results)."].filter(Boolean).join("\n"),
        });
      } else if (was.active && rearmed(a, p.price)) s = { active: false, rearmedAt: now.toISOString() };
    }
    state[a.id] = s;
    const dist = p ? Math.round((p.price / a.level - 1) * 1000) / 10 : null;
    view.push({ id: a.id, symbol: a.symbol, name: a.name, note: a.note, dir: a.dir, level: a.level, price: p?.price ?? null, date: p?.date ?? null, distPct: dist, active: !!s.active, firedAt: s.active ? s.at ?? null : null });
  }
  return { alerts, state, view, invalid: parsed.invalid, fired };
}

// Reached log: every fire, kept after the level re-arms (state forgets it
// then), newest last, capped. Lives in state.json as `priceAlertLog`.
export const LOG_MAX = 40;
export function withReached(log, fired = []) {
  return [...(Array.isArray(log) ? log : []), ...(fired ?? [])].slice(-LOG_MAX);
}
// Decorate view rows with their latest fire: lastAt (London-agnostic ISO
// date), lastPrice and the move since then from today's price.
withReached.view = (view = [], log = []) => view.map((v) => {
  const hit = (log ?? []).findLast((e) => e.id === v.id);
  const since = hit && v.price > 0 && hit.price > 0 ? Math.round((v.price / hit.price - 1) * 1000) / 10 : null;
  return { ...v, lastAt: hit ? hit.at.slice(0, 10) : null, lastPrice: hit ? hit.price : null, sincePct: since };
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const sinceText = (a) => (a.lastAt ? ` (${dayMonth(a.lastAt)} at ${fmt(a.lastPrice)}${!a.sincePct ? "" : `, ${a.sincePct > 0 ? "+" : ""}${a.sincePct}% since`})` : "");

// The move still needed from today's price to reach the level, in percent
// (positive while armed and short of it). Measured from the price, so "6.9%
// to go" means a 6.9% fall or rise from here. Null without a price.
export function toGo(a) {
  if (!(a?.price > 0) || !(a.level > 0)) return null;
  const pct = a.dir === "below" ? (1 - a.level / a.price) * 100 : (a.level / a.price - 1) * 100;
  return Math.round(pct * 10) / 10;
}

// Rebuild the file's alerts list from the Dashboard view (one row per
// direction) plus an optional new or changed entry, for copy and paste into
// price-alerts.json on GitHub. Rows rejoin their file entry: same symbol and
// note, direction still free (so staged tiers, several entries for one stock,
// stay separate). A new level matching an existing one updates its note; where
// the stock has one level in that direction it is replaced; where it has two
// or more (tiers) it is added as another tier. `remove` drops a symbol.
export function fileWith(view = [], add = null, remove = null) {
  const out = [];
  const fits = (e, dir, level) => e[dir] == null && (dir === "below" ? e.above == null || level < e.above : e.below == null || level > e.below);
  const place = (symbol, name, dir, level, note) => {
    let e = out.find((x) => x.symbol === symbol && (x.note ?? null) === (note ?? null) && fits(x, dir, level));
    if (!e) {
      e = { symbol, ...(name ? { name } : {}) };
      out.push(e);
    }
    e[dir] = level;
    if (note) { delete e.note; e.note = note; }
    return e;
  };
  for (const v of view) {
    if (!v?.symbol || v.symbol === remove) continue;
    place(v.symbol, v.name, v.dir, v.level, v.note ?? null);
  }
  if (add?.symbol && Number(add.level) > 0 && (add.dir === "below" || add.dir === "above")) {
    const sym = String(add.symbol).trim().toUpperCase(), level = Number(add.level), dir = add.dir;
    const same = out.filter((e) => e.symbol === sym && e[dir] != null);
    const hit = same.find((e) => e[dir] === level) ?? (same.length === 1 ? same[0] : null);
    if (hit) {
      hit[dir] = level;
      if (add.name) hit.name = add.name;
      if (add.note) { delete hit.note; hit.note = add.note; }
    } else {
      const e = same.length ? null : out.find((x) => x.symbol === sym && fits(x, dir, level));
      if (e) {
        e[dir] = level;
        if (add.name) e.name = add.name;
        if (add.note) { delete e.note; e.note = add.note; }
      } else {
        const name = add.name || out.find((x) => x.symbol === sym)?.name;
        const at = out.findLastIndex((x) => x.symbol === sym); // beside its other tiers
        out.splice(at < 0 ? out.length : at + 1, 0, { symbol: sym, ...(name ? { name } : {}), [dir]: level, ...(add.note ? { note: add.note } : {}) });
      }
    }
  }
  return out;
}

// One digest line: the armed alerts closest to their level (within `within`
// percent), and any that are currently reached. Null when there are none.
export function digestLine(view = [], within = 10, max = 3) {
  const fmtL = (a) => `${a.name || a.symbol} ${a.dir} ${fmtLevel(a.level)}`;
  const reached = view.filter((a) => a.active);
  const near = view.filter((a) => !a.active && a.price != null)
    .map((a) => ({ a, togo: toGo(a) }))
    .filter((x) => x.togo > 0 && x.togo <= within).sort((x, y) => x.togo - y.togo).slice(0, max);
  if (!reached.length && !near.length) return view.length ? `Price alerts: ${view.length} set, none within ${within}% of its level.` : null;
  const parts = [];
  if (reached.length) parts.push(`reached: ${reached.map((a) => fmtL(a) + sinceText(a)).join(", ")}`);
  if (near.length) parts.push(`closest: ${near.map(({ a, togo }) => `${fmtL(a)} (${togo.toFixed(1)}% to go)`).join(", ")}`);
  return `Price alerts ${parts.join("; ")}.`;
}
