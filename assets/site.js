// Shared helpers for both pages: theme toggle, formatting, small SVG charts.

const THEME_KEY = "mm-theme";
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  if (saved) document.documentElement.dataset.theme = saved;
  const btn = document.getElementById("themeBtn");
  if (!btn) return;
  const sync = () => {
    const dark = currentDark();
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.innerHTML = dark
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  };
  btn.addEventListener("click", () => {
    const next = currentDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    sync();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", sync);
  sync();
}
function currentDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const minus = (s) => String(s).replace(/(^|[\s(])-(?=\d)/g, "$1\u2212");
export const signPct = (v, dp = 1) => (v == null ? "n/a" : minus(`${v >= 0 ? "+" : ""}${Number(v).toFixed(dp)}%`));
export const pnClass = (v) => (v == null ? "muted" : v >= 0 ? "pos" : "neg");
export const num = (v, dp = 0) => (v == null ? "n/a" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const fmtDate = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function fmtDM(ymd) { const d = new Date(ymd + "T12:00:00Z"); return isNaN(d) ? ymd : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); }
export function fmtDay(ymd) { const d = new Date(ymd + "T12:00:00Z"); return isNaN(d) ? ymd : `${WD[d.getUTCDay()]} ${d.getUTCDate()}`; }
export function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h}h ago` : `${Math.round(h / 24)} days ago`;
}
export function money(v, currency) {
  if (v == null) return "n/a";
  if (currency === "GBp") return `${num(v, 0)}p`;
  const sym = { USD: "$", GBP: "£", EUR: "€" }[currency] ?? "";
  return `${sym}${num(v, 2)}`;
}
export function bigMoney(v, currency) {
  if (v == null) return "n/a";
  const sym = { USD: "$", GBP: "£", GBp: "£", EUR: "€" }[currency] ?? "";
  const a = Math.abs(v);
  return a >= 1e12 ? `${sym}${(v / 1e12).toFixed(2)}tn` : a >= 1e9 ? `${sym}${(v / 1e9).toFixed(1)}bn` : `${sym}${(v / 1e6).toFixed(0)}m`;
}
export const toneVar = (score) => (score == null ? "var(--faint)" : score >= 65 ? "var(--buy)" : score >= 50 ? "var(--buylite)" : score >= 35 ? "var(--watch)" : "var(--sell)");

// Line chart of rebased values with a zero line.
export function sparkline(values, w, h, colour, { zero = true, fill = false } = {}) {
  if (!values || values.length < 2) return "";
  const pad = 4, min = Math.min(0, ...values), max = Math.max(0, ...values), range = max - min || 1;
  const x = (i) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  let s = zero ? `<line x1="${pad}" x2="${w - pad}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 3"/>` : "";
  if (fill) s += `<polygon points="${x(0).toFixed(1)},${y(0).toFixed(1)} ${pts} ${x(values.length - 1).toFixed(1)},${y(0).toFixed(1)}" fill="${colour}" opacity="0.08"/>`;
  return s + `<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
}
