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

// state: { [id]: { active, at, price } }. Returns { alerts, state, view }.
// `prices` maps symbol to latestPrice() output (or null).
export function checkAlerts(parsed, prices, prevState = {}, now = new Date()) {
  const state = {}, alerts = [], view = [];
  for (const a of parsed.alerts) {
    const p = prices[a.symbol] ?? null;
    const was = prevState[a.id] ?? { active: false };
    let s = { ...was };
    if (p) {
      if (!was.active && crossed(a, p.price)) {
        s = { active: true, at: now.toISOString(), price: p.price };
        const label = a.name || a.symbol;
        alerts.push({
          kind: "price", priority: "high", tags: a.dir === "below" ? "chart_with_downwards_trend" : "chart_with_upwards_trend",
          title: `${label} ${a.dir === "below" ? "at or below" : "at or above"} ${fmt(a.level)}`,
          body: [`${label} (${a.symbol}) is ${fmt(p.price)}${p.dayPct == null ? "" : ` (${p.dayPct > 0 ? "+" : ""}${p.dayPct}% today)`}, your alert level was ${fmt(a.level)}.`,
            a.note ? `Your note: ${a.note}` : null,
            "Check the Research page and the plan before acting (no trade within 7 days before results)."].filter(Boolean).join("\n"),
        });
      } else if (was.active && rearmed(a, p.price)) s = { active: false, rearmedAt: now.toISOString() };
    }
    state[a.id] = s;
    const dist = p ? Math.round((p.price / a.level - 1) * 1000) / 10 : null;
    view.push({ id: a.id, symbol: a.symbol, name: a.name, note: a.note, dir: a.dir, level: a.level, price: p?.price ?? null, date: p?.date ?? null, distPct: dist, active: !!s.active, firedAt: s.active ? s.at ?? null : null });
  }
  return { alerts, state, view, invalid: parsed.invalid };
}

// Rebuild the file's alerts list from the Dashboard view (one row per
// direction) plus an optional new or changed entry, for copy and paste into
// price-alerts.json on GitHub. A new level for the same symbol and direction
// replaces the old one; `remove` drops a symbol entirely.
export function fileWith(view = [], add = null, remove = null) {
  const by = new Map();
  for (const v of view) {
    if (!v?.symbol || v.symbol === remove) continue;
    const e = by.get(v.symbol) ?? { symbol: v.symbol, ...(v.name ? { name: v.name } : {}) };
    e[v.dir] = v.level;
    if (v.note && !e.note) e.note = v.note;
    by.set(v.symbol, e);
  }
  if (add?.symbol && Number(add.level) > 0 && (add.dir === "below" || add.dir === "above")) {
    const sym = String(add.symbol).trim().toUpperCase();
    const e = by.get(sym) ?? { symbol: sym };
    if (add.name) e.name = add.name;
    e[add.dir] = Number(add.level);
    if (add.note) e.note = add.note;
    by.set(sym, e);
  }
  return [...by.values()];
}
