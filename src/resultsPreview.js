// Results preview (Douglas, 12 Nov 2026: "I want a better signal on upcoming
// results and how shares will jump"). Display and heads-up only, never a buy
// signal: the direction of a results-day move cannot be called in advance
// (swing lab rounds 2 and 4, research log 10 Nov), but its usual SIZE can be
// shown, and so can whether a jump would make it a short-term pot buy.
//   - resultsPreview(): built by the nightly scan (scan.json resultsPreview).
//     "focus": the research list, picks and bench with results in the next 7
//     days; "watch": other S&P 500 and FTSE 100 names reporting (the pot's
//     universe), biggest usual movers first.
//   - resultsAlert(): the morning push (kind "results"), once when a focus name
//     enters the window and again the day before it reports.
export const PREVIEW = { days: 7, watchMax: 8, keep: 4 };
const POT_INDEX = new Set(["S&P 500", "FTSE 100"]);
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

// Usual results-day move from about a year of daily bars: the close-to-close
// move on each real results date, last 4, and the median of their sizes.
// events: [{ date, after }] or plain dates. after true: reported after the
// close, so the reaction is the next session; false: that session; unknown
// (plain dates from history/results-dates.json): the bigger move of that
// session and the next, a slight upward lean (the safe side for a risk guide).
// Real dates only: on 12 Nov the busiest-day guess matched only 36% of
// hand-checked dates (large caps often trade under 2x their normal volume on
// results), so it is not used here (research log 12 Nov).
export function typicalMove(rows = [], events = [], afterClose = false) {
  if (!rows?.length || rows.length < 2) return null;
  const mv = (i) => rows[i].close / rows[i - 1].close - 1;
  const days = new Set();
  for (const e of events ?? []) {
    const k = typeof e === "string" ? e : e?.date, after = typeof e === "string" ? (afterClose ? true : null) : e?.after ?? null;
    if (!k) continue;
    const i = rows.findIndex((r) => (after === true ? r.date > k : r.date >= k));
    if (i < 1) continue;
    days.add(after != null || !rows[i + 1] || Math.abs(mv(i)) >= Math.abs(mv(i + 1)) ? i : i + 1);
  }
  const moves = [...days].sort((a, b) => a - b).slice(-PREVIEW.keep).map((i) => ({ date: rows[i].date, pct: Math.round(mv(i) * 1000) / 10 }));
  if (!moves.length) return null;
  const abs = moves.map((m) => Math.abs(m.pct)).sort((a, b) => a - b), h = abs.length / 2;
  const typical = abs.length % 2 ? abs[Math.floor(h)] : (abs[h - 1] + abs[h]) / 2;
  return { n: moves.length, typical: Math.round(typical * 10) / 10, moves };
}

// The next results date the scan knows: Yahoo's date, else its estimate
// (flagged, and only when not marked stale).
function nextDate(it) {
  if (it.earnings?.date) return { date: it.earnings.date, estimated: false };
  const e = it.resultsEstimate;
  if (e?.date && !e.stale) return { date: e.date, estimated: true };
  return null;
}

// Names reporting in the window: focus names and the pot's open holdings (any
// date the scan has, estimates flagged) and S&P 500 / FTSE 100 names with a
// firm date.
export function previewCandidates(items = [], { today, focus = new Set(), held = new Set(), days = PREVIEW.days } = {}) {
  const out = [];
  for (const it of items) {
    const nd = nextDate(it);
    if (!nd) continue;
    const inDays = dayDiff(nd.date, today);
    if (inDays < 0 || inDays > days) continue;
    const isFocus = focus.has(it.symbol) || held.has(it.symbol), pot = POT_INDEX.has(it.index);
    if (!isFocus && (!pot || nd.estimated)) continue;
    out.push({ it, nd, inDays, isFocus, pot });
  }
  return out;
}

// Names that may have reported in the last few days (for "Just reported"):
// a stored or scheduled results date from 4 days ago to today.
export function recentCandidates(items = [], { today, focus = new Set(), dates = {} } = {}) {
  return items.filter((it) => {
    if (!focus.has(it.symbol) && !POT_INDEX.has(it.index)) return false;
    const ds = [...(dates[it.symbol] ?? []), ...(it.earnings?.date ? [it.earnings.date] : [])];
    return ds.some((d) => { const k = dayDiff(today, d); return k >= 0 && k <= 4; });
  });
}

// The beat record from timed history with EPS: last 8 with a surprise.
export function beatRecord(hist = [], today) {
  const xs = hist.filter((e) => e.date < today && e.surprisePct != null).slice(-8);
  if (!xs.length) return null;
  const s = [...xs.map((e) => e.surprisePct)].sort((a, b) => a - b), h = s.length / 2;
  return { n: xs.length, beats: xs.filter((e) => e.surprisePct > 0).length, median: Math.round((s.length % 2 ? s[Math.floor(h)] : (s[h - 1] + s[h]) / 2) * 10) / 10, last: xs.at(-1) };
}

// items: the scan's output items. focus: Set of symbols (research list, picks,
// bench). held: the short-term pot's open symbols. rowsBySymbol: daily bars.
// reported: { symbol: [{ date, after, surprisePct? }] } (fetchResultsHistory).
// dates: history/results-dates.json (plain dates). afterClose: hand-checked
// after-close reporters.
export function resultsPreview(items = [], { today, focus = new Set(), held = new Set(), rowsBySymbol = {}, reported = {}, dates = {}, afterClose = new Set(), days = PREVIEW.days } = {}) {
  const rows = [];
  for (const { it, nd, inDays, isFocus, pot } of previewCandidates(items, { today, focus, held, days })) {
    const timed = (reported[it.symbol] ?? []).filter((e) => e.date < today);
    const plain = (dates[it.symbol] ?? []).filter((d) => d < today && !timed.some((e) => e.date === d)).map((d) => (afterClose.has(it.symbol) ? { date: d, after: true } : d));
    const moves = typicalMove(rowsBySymbol[it.symbol], [...timed, ...plain]);
    const rc = it.resultsCheck, rec = beatRecord(timed, today);
    rows.push({
      symbol: it.symbol, ticker: it.ticker, name: it.name, market: it.market, index: it.index,
      date: nd.date, estimated: nd.estimated, days: inDays, focus: isFocus, pot, held: held.has(it.symbol),
      typical: moves?.typical ?? null, moves: moves?.moves ?? [],
      record: rec ? { n: rec.n, beats: rec.beats, median: rec.median } : null,
      last: rc?.surprisePct != null ? { surprisePct: rc.surprisePct, reaction: rc.reaction ?? null, date: rc.date ?? null }
        : rec ? { surprisePct: rec.last.surprisePct, reaction: moveOn(rowsBySymbol[it.symbol], rec.last), date: rec.last.date } : null,
    });
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (b.typical ?? 0) - (a.typical ?? 0));
  const focusRows = rows.filter((r) => r.focus).sort(byDate);
  const others = rows.filter((r) => !r.focus && r.pot);
  const watch = [...others].sort((a, b) => (b.typical ?? -1) - (a.typical ?? -1) || byDate(a, b)).slice(0, PREVIEW.watchMax);
  return { date: today, days, focus: focusRows, watch, potCount: others.length };
}

// The close-to-close move on an event's reaction session.
function moveOn(rows, e) {
  if (!rows?.length || !e) return null;
  const i = rows.findIndex((r) => (e.after === true ? r.date > e.date : r.date >= e.date));
  return i >= 1 ? Math.round((rows[i].close / rows[i - 1].close - 1) * 1000) / 10 : null;
}

// Just reported: names whose results reaction session is the latest bar.
// move, volume against the previous 50 sessions, the surprise, and whether it
// meets the pot's drift trigger (4%+ on 3x) as it stands. skip: names on the
// pot's skip list (data/pot-skip.json): never a pot buy, flagged potSkip.
export function justReported(items = [], { rowsBySymbol = {}, reported = {}, focus = new Set(), skip = new Set() } = {}) {
  const out = [];
  for (const it of items) {
    const rows = rowsBySymbol[it.symbol], hist = reported[it.symbol];
    if (!rows?.length || rows.length < 52 || !hist?.length) continue;
    const d = rows.length - 1, last = rows[d].date;
    const ev = hist.find((e) => { const i = rows.findIndex((r) => (e.after === true ? r.date > e.date : r.date >= e.date)); return i === d; });
    if (!ev) continue;
    const avg = rows.slice(d - 50, d).reduce((a, r) => a + (r.volume || 0), 0) / 50;
    const move = Math.round((rows[d].close / rows[d - 1].close - 1) * 1000) / 10, volX = avg > 0 ? Math.round(((rows[d].volume || 0) / avg) * 10) / 10 : null;
    out.push({ symbol: it.symbol, ticker: it.ticker, name: it.name, market: it.market, date: last, move, volX, surprisePct: ev.surprisePct ?? null,
      focus: focus.has(it.symbol), pot: POT_INDEX.has(it.index), potBuy: POT_INDEX.has(it.index) && move >= 4 && volX != null && volX >= 3 && !skip.has(it.symbol), ...(skip.has(it.symbol) ? { potSkip: true } : {}) });
  }
  return out.sort((a, b) => (b.focus - a.focus) || Math.abs(b.move) - Math.abs(a.move)).slice(0, 12);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (date, today) => {
  const n = dayDiff(date, today);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  const d = new Date(date + "T12:00:00Z");
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
const sp = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

// One line per company, plain enough for a phone.
export function previewLine(r, today) {
  const when = `${dayLabel(r.date, today)}${r.estimated ? " (estimated date)" : ""}`;
  const usual = r.typical == null ? "no past results day in the data yet"
    : r.moves.length === 1 ? `moved ${sp(r.moves[0].pct)} on its last results day (the only one on record so far)`
    : `usually moves ±${r.typical.toFixed(1)}% on results (last ${r.moves.length}: ${r.moves.map((m) => sp(m.pct)).join(", ")})`;
  const last = r.last ? `; last time EPS ${sp(r.last.surprisePct)} vs forecast${r.last.reaction != null ? `, ${sp(r.last.reaction)} on the day` : ""}` : "";
  const rec = r.record?.n >= 4 ? `; beat the forecast ${r.record.beats} of the last ${r.record.n} times` : "";
  const held = r.held ? " The short-term pot holds it, so its results land inside the trade (the rules keep it; this is a heads-up)." : "";
  return `${r.ticker} ${when}: ${usual}${last}${rec}.${held}`;
}

// The morning push. sent: { "SYM|date": ["week", "eve"] } from monitor state.
// today: London date at the run (stages use it, not the scan's date).
export function resultsAlert(preview, sent = {}, today) {
  const next = Object.fromEntries(Object.entries(sent ?? {}).filter(([k]) => k.split("|")[1] >= today));
  if (!preview?.focus?.length) return { alert: null, sent: next };
  // From tomorrow on: by the morning of results day the push is too late to
  // be useful (most UK and many US names report before the open).
  const live = preview.focus.map((r) => ({ ...r, days: dayDiff(r.date, today) })).filter((r) => r.days >= 1 && r.days <= (preview.days ?? PREVIEW.days));
  const fresh = [];
  for (const r of live) {
    const key = `${r.symbol}|${r.date}`, have = next[key] ?? [];
    const stage = r.days <= 1 ? "eve" : "week";
    if (!have.includes(stage)) { fresh.push(r); next[key] = [...new Set([...have, "week", stage])]; }
  }
  if (!fresh.length) return { alert: null, sent: next };
  const names = fresh.map((r) => `${r.ticker} ${dayLabel(r.date, today)}`);
  const title = `Results ahead: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
  const body = [
    ...fresh.map((r) => previewLine(r, today)),
    ...(live.length > fresh.length ? [`Also this week: ${live.filter((r) => !fresh.includes(r)).map((r) => `${r.ticker} ${dayLabel(r.date, today)}`).join(", ")}.`] : []),
    "The size is a guide to the risk, not the direction, which can't be called in advance.",
  ];
  const potNames = fresh.filter((r) => r.pot).map((r) => r.ticker);
  if (potNames.length) body.push(`${potNames.join(", ")}: a close up 4%+ on 3× normal volume would make ${potNames.length > 1 ? "any of them" : "it"} a short-term pot buy, pushed that evening.`);
  return { alert: { kind: "results", priority: "default", tags: "spiral_calendar", title, body: body.join("\n") }, sent: next };
}

// The EPS surprise of the results whose reaction session is `date` (a drift
// signal's day), from timed history; null if none matches or no forecast.
// Used to rank the short-term pot's drift signals (12 Nov).
export function surpriseOn(rows = [], hist = [], date) {
  for (const e of hist ?? []) {
    const i = rows.findIndex((r) => (e.after === true ? r.date > e.date : r.date >= e.date));
    if (i >= 0 && rows[i].date === date) return e.surprisePct ?? null;
  }
  return null;
}
