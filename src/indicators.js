// Technical indicators on daily bars. All functions take arrays oldest-first
// and return arrays aligned to the input (null where not yet defined).
import { pct } from "./util.js";

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

// Wilder's RSI.
export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = values[i] - values[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast), es = ema(values, slow);
  const line = values.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const start = line.findIndex((v) => v != null);
  const sig = new Array(values.length).fill(null);
  if (start >= 0) {
    const e = ema(line.slice(start), signal);
    e.forEach((v, i) => { sig[start + i] = v; });
  }
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

export function bollinger(values, n = 20, k = 2) {
  const mid = sma(values, n);
  return values.map((v, i) => {
    if (mid[i] == null) return null;
    const win = values.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(win.reduce((a, x) => a + (x - mid[i]) ** 2, 0) / n);
    const upper = mid[i] + k * sd, lower = mid[i] - k * sd;
    return { mid: mid[i], upper, lower, pctB: upper === lower ? 0.5 : (v - lower) / (upper - lower) };
  });
}

export function atr(rows, n = 14) {
  const tr = rows.map((r, i) => (i === 0 ? r.high - r.low
    : Math.max(r.high - r.low, Math.abs(r.high - rows[i - 1].close), Math.abs(r.low - rows[i - 1].close))));
  const out = new Array(rows.length).fill(null);
  if (rows.length <= n) return out;
  let prev = tr.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
  out[n] = prev;
  for (let i = n + 1; i < rows.length; i++) { prev = (prev * (n - 1) + tr[i]) / n; out[i] = prev; }
  return out;
}

// Drawdown of the latest close from the highest close in the lookback window.
export function drawdown(rows, lookback = 252) {
  if (!rows?.length) return null;
  const win = rows.slice(-lookback);
  let peak = win[0];
  for (const r of win) if (r.close > peak.close) peak = r;
  const last = rows[rows.length - 1];
  return { last: last.close, lastDate: last.date, peak: peak.close, peakDate: peak.date, pct: pct(last.close, peak.close) };
}

// Percentage changes between consecutive closes for the last n sessions.
export function lastChanges(rows, n = 5) {
  const tail = rows.slice(-(n + 1)), out = [];
  for (let i = 1; i < tail.length; i++) out.push({ date: tail[i].date, pct: Math.round(pct(tail[i].close, tail[i - 1].close) * 100) / 100 });
  return out;
}

export const changeOver = (closes, n) => (closes.length > n ? pct(closes[closes.length - 1], closes[closes.length - 1 - n]) : null);

export const rebase = (closes, n = 30) => {
  const win = closes.slice(-n), b0 = win[0];
  return win.map((v) => Math.round(((v - b0) / b0) * 10000) / 100);
};

// Did series a cross above (or below) series b within the last `within` bars?
export function crossed(a, b, within, dir = "up") {
  for (let i = a.length - within; i < a.length; i++) {
    if (i < 1 || a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) continue;
    const eps = 1e-9 * Math.max(1, Math.abs(b[i - 1]));
    if (dir === "up" && a[i - 1] <= b[i - 1] + eps && a[i] > b[i] + eps) return true;
    if (dir === "down" && a[i - 1] >= b[i - 1] - eps && a[i] < b[i] - eps) return true;
  }
  return false;
}
