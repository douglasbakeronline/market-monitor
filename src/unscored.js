// Scan names that get no score tonight, and why (21 Nov 2026). Vylor (VYLR)
// joined the S&P 500 on 19 Nov and failed to score every night since, with
// only "1 failed" in the log and nothing on the Index scan page: a company in
// the index silently missing from every list. Each one now carries a reason
// (a new listing with too few sessions, no prices at all, or stopped trading)
// and, for a new listing, roughly when it will get a score.
import { nextSession } from "./sessions.js";

// technicals() needs this many daily bars (src/research.js).
export const MIN_SESSIONS = 60;

const LABEL = { SP500: "S&P 500", FTSE100: "FTSE 100", EUROSTOXX50: "Euro Stoxx 50", NASDAQ100: "Nasdaq 100" };
const dmy = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).replace(",", "");
const marketOf = (index) => (index === "SP500" || index === "NASDAQ100" ? "US" : "UK");

// The session on which a listing with `have` bars up to `last` reaches MIN_SESSIONS.
function sessionsAfter(last, n, market) {
  let d = last;
  for (let i = 0; i < n; i++) d = nextSession(d, market);
  return d;
}

// u: the universe entry ({ symbol, name, index }); rows: the bars fetched (if
// any); error: the fetch error (if any); stale: { last, behind } when the
// stock was dropped for not trading.
export function unscoredEntry(u, { rows = null, error = null, stale = null } = {}) {
  const head = `${u.name || u.symbol} (${u.symbol.replace(/\.L$/, "")}, ${LABEL[u.index] ?? u.index})`;
  const base = { symbol: u.symbol, name: u.name ?? null, index: LABEL[u.index] ?? u.index ?? null };
  if (stale) return { ...base, reason: "stale", sessions: rows?.length ?? null, last: stale.last, scoresFrom: null, text: `${head}: last traded ${dmy(stale.last)} (${stale.behind} sessions behind), so it is left out until it trades again.` };
  const n = rows?.length ?? 0;
  if (!n) {
    const why = error?.message ? ` (${String(error.message).slice(0, 80)})` : "";
    return { ...base, reason: "fetch", sessions: 0, scoresFrom: null, text: `${head}: no prices from Yahoo tonight${why}.` };
  }
  const first = rows[0].date, last = rows[n - 1].date;
  const scoresFrom = n < MIN_SESSIONS ? sessionsAfter(last, MIN_SESSIONS - n, marketOf(u.index)) : null;
  if (n < MIN_SESSIONS) return { ...base, reason: "new", sessions: n, first, last, scoresFrom, text: `${head}: new listing, ${n} session${n === 1 ? "" : "s"} of prices since ${dmy(first)}; it gets a score from about ${dmy(scoresFrom)} (${MIN_SESSIONS} needed).` };
  const why = error?.message ? ` (${String(error.message).slice(0, 80)})` : "";
  return { ...base, reason: "error", sessions: n, first, last, scoresFrom: null, text: `${head}: could not be scored tonight${why}.` };
}

// One log line for the scan, or null when every name scored.
export function unscoredLine(list) {
  if (!list?.length) return null;
  const part = (e) => {
    const t = e.symbol.replace(/\.L$/, "");
    if (e.reason === "new") return `${t} new listing, ${e.sessions} sessions (scores from ${e.scoresFrom})`;
    if (e.reason === "stale") return `${t} stopped trading ${e.last}`;
    if (e.reason === "fetch") return `${t} no prices`;
    return `${t} error`;
  };
  return `Not scored (${list.length}): ${list.map(part).join("; ")}.`;
}
