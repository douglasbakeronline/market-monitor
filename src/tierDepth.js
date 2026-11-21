// Research and display: once an index has fallen to a buy tier, how often did
// the fall go on to the deeper tiers, how fast, and how long until the index
// was back within 5% of its high (where the tiers re-arm)?
// Pure functions over daily rows [{date, close}] (oldest first). The drawdown
// is the live rule's: off the highest close of the past 252 sessions.
import { drawdowns } from "./dipStudy.js";

const LEVELS = [-10, -15, -20, -30];
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// Episodes start at the first close at or below the first level (from a
// re-armed state) and end at the first close back within `reset`% of the high.
// Each episode records when it first closed at each level, its trough, and
// when it re-armed (null while still open at the end of the data).
export function depthEpisodes(rows, { levels = LEVELS, reset = -5, warm = 252, from = null } = {}) {
  const dd = drawdowns(rows);
  const eps = [];
  let ep = null;
  for (let i = warm; i < rows.length; i++) {
    if (ep) {
      if (dd[i] >= reset) { ep.end = i; eps.push(ep); ep = null; continue; }
      if (dd[i] < ep.trough) { ep.trough = dd[i]; ep.troughAt = i; }
      for (const l of levels) if (ep.at[l] == null && dd[i] <= l) ep.at[l] = i;
    } else if (dd[i] <= levels[0] && (!from || rows[i].date >= from)) {
      ep = { start: i, at: {}, trough: dd[i], troughAt: i, end: null };
      for (const l of levels) if (dd[i] <= l) ep.at[l] = i;
    }
  }
  if (ep) eps.push(ep);
  return eps.map((e) => ({
    start: rows[e.start].date,
    reached: Object.fromEntries(Object.entries(e.at).map(([l, i]) => [l, { date: rows[i].date, sessions: i - e.start }])),
    trough: r1(e.trough),
    troughDate: rows[e.troughAt].date,
    rearmed: e.end == null ? null : rows[e.end].date,
    sessions: e.end == null ? null : e.end - e.start,
    open: e.end == null,
    _at: e.at, _end: e.end,
  }));
}

// From each level: how many closed episodes reached it, how many of those went
// on to each deeper level (and the median sessions between the two first
// closes), the median trough, and the median sessions to re-arm.
export function depthSummary(eps, levels = LEVELS) {
  const closed = eps.filter((e) => !e.open);
  const out = {};
  for (const l of levels.slice(0, -1)) {
    const base = closed.filter((e) => e._at[l] != null);
    if (!base.length) { out[l] = { n: 0 }; continue; }
    const deeper = {};
    for (const m of levels.filter((x) => x < l)) {
      const hit = base.filter((e) => e._at[m] != null);
      deeper[m] = { n: hit.length, sessions: median(hit.map((e) => e._at[m] - e._at[l])) };
    }
    out[l] = {
      n: base.length,
      deeper,
      trough: r1(median(base.map((e) => e.trough))),
      rearm: median(base.map((e) => e._end - e._at[l])),
    };
  }
  return out;
}

// The study as stored in data/tier-depth.json: one block per sample.
export function tierDepth(rows, opt = {}) {
  const eps = depthEpisodes(rows, opt);
  const firstFrom = opt.from || rows[Math.min(rows.length - 1, opt.warm ?? 252)]?.date;
  const strip = ({ _at, _end, ...e }) => e;
  return {
    from: firstFrom,
    to: rows.at(-1)?.date,
    episodes: eps.filter((e) => !e.open).length,
    fromLevel: depthSummary(eps),
    recent: eps.slice(-8).map(strip),
    open: eps.filter((e) => e.open).map(strip)[0] || null,
  };
}

const weeks = (s) => {
  if (s == null) return null;
  const w = Math.round(s / 5);
  return w < 2 ? "within about a week" : w < 9 ? `about ${w} weeks later` : `about ${Math.round(s / 21)} months later`;
};
const months = (s) => (s == null ? null : s < 32 ? `about ${Math.max(1, Math.round(s / 5))} weeks` : `about ${Math.round(s / 21)} months`);
const neg = (n) => `−${Math.abs(n)}%`;

// One line for a Dashboard buy-tier card: from the deepest tier the index has
// reached, what followed in past falls. Null above the first tier or when the
// sample has too few episodes to say anything (under 5).
export function depthLine(sample, drawdown, { name = "the index" } = {}) {
  if (!sample?.fromLevel || drawdown == null) return null;
  const lvl = [-30, -20, -15, -10].find((l) => drawdown <= l);
  if (lvl == null || lvl === -30) return null;
  const s = sample.fromLevel[lvl];
  if (!s?.n || s.n < 5) return null;
  const deeper = Object.entries(s.deeper).map(([m, v]) => [Number(m), v]).sort((a, b) => b[0] - a[0]);
  const parts = deeper.map(([m, v], k) => `${k ? "" : "went on to "}${neg(m)} in ${v.n}${k === 0 && v.n && v.sessions != null ? ` (${weeks(v.sessions)}, median)` : ""}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const year = sample.from.slice(0, 4);
  return `Of ${s.n} falls since ${year} that closed at ${neg(lvl)}, ${name} ${list}. The median low was ${neg(Math.abs(s.trough).toFixed(0))}; it took a median of ${months(s.rearm)} to get back within 5% of its high.`;
}
