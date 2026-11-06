// Research: what follows big one-day index falls and 5% pullbacks, and does
// buying at the pullback trigger beat waiting for the scheduled date?
// Pure functions over daily rows [{date, close}] (oldest first).

const HORIZONS = { m1: 21, m3: 63, m6: 126, y1: 252 };

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

export function stats(xs) {
  if (!xs.length) return { n: 0, median: null, mean: null, positive: null };
  return {
    n: xs.length,
    median: round1(median(xs)),
    mean: round1(xs.reduce((a, b) => a + b, 0) / xs.length),
    positive: Math.round((xs.filter((x) => x > 0).length / xs.length) * 100),
  };
}

// Forward % return from bar i over h bars, or null near the end of the data.
export function fwd(rows, i, h) {
  const j = i + h;
  return j < rows.length ? (rows[j].close / rows[i].close - 1) * 100 : null;
}

// Drawdown from the rolling 52-week (252-bar) closing high, per bar.
export function drawdowns(rows, win = 252) {
  const out = new Array(rows.length);
  const dq = []; // indices with decreasing closes (monotonic deque)
  for (let i = 0; i < rows.length; i++) {
    while (dq.length && rows[dq[dq.length - 1]].close <= rows[i].close) dq.pop();
    dq.push(i);
    while (dq[0] <= i - win) dq.shift();
    out[i] = (rows[i].close / rows[dq[0]].close - 1) * 100;
  }
  return out;
}

// Indices of one-day falls of at least `pct`%, plus "first in a cluster"
// (no other such fall in the previous `gap` sessions).
export function bigFalls(rows, pct = 4, gap = 21) {
  const all = [], first = [];
  let last = -Infinity;
  for (let i = 1; i < rows.length; i++) {
    const d = (rows[i].close / rows[i - 1].close - 1) * 100;
    if (d <= -pct) {
      all.push(i);
      if (i - last > gap) first.push(i);
      last = i;
    }
  }
  return { all, first };
}

// Pullback triggers: the first close at least `trigger`% below the 52-week
// high; re-armed only once the index is back within `rearm`% of its high.
export function pullbacks(rows, dd, trigger = 5, rearm = 1, warm = 252) {
  const out = [];
  let armed = true;
  for (let i = warm; i < rows.length; i++) {
    if (armed && dd[i] <= -trigger) { out.push(i); armed = false; }
    else if (!armed && dd[i] >= -rearm) armed = true;
  }
  return out;
}

const forwardSet = (rows, idx) => Object.fromEntries(Object.entries(HORIZONS).map(([k, h]) =>
  [k, stats(idx.map((i) => fwd(rows, i, h)).filter((x) => x != null))]));

// Buying at bar i rather than k bars later: % saved (positive = early buy was
// cheaper). For all bars this is the baseline cost of waiting in a rising market.
const earlyGain = (rows, i, k) => {
  const j = i + k;
  return j < rows.length ? (rows[j].close / rows[i].close - 1) * 100 : null;
};

export function analyseIndex(rows, { warm = 252 } = {}) {
  const dd = drawdowns(rows);
  const every = [];
  for (let i = warm; i < rows.length; i++) every.push(i);
  const falls4 = bigFalls(rows, 4), falls3 = bigFalls(rows, 3);
  const pb = pullbacks(rows, dd, 5, 1, warm);

  // After each pullback trigger: how deep did the fall go within 12 months?
  const depth = pb.map((i) => {
    let lo = 0;
    for (let j = i; j < Math.min(rows.length, i + 253); j++) lo = Math.min(lo, dd[j]);
    return { i, lo, complete: i + 252 < rows.length };
  }).filter((x) => x.complete);
  const reach = (t) => (depth.length ? Math.round((depth.filter((x) => x.lo <= -t).length / depth.length) * 100) : null);

  const early = {};
  for (const k of [5, 10, 21]) {
    early[`k${k}`] = {
      trigger: stats(pb.map((i) => earlyGain(rows, i, k)).filter((x) => x != null)),
      baseline: stats(every.map((i) => earlyGain(rows, i, k)).filter((x) => x != null)),
    };
  }
  const wf = (idx) => idx.filter((i) => i >= warm);
  return {
    from: rows[warm]?.date, to: rows[rows.length - 1]?.date, sessions: rows.length - warm,
    baseline: forwardSet(rows, every),
    fall4: { days: wf(falls4.all).length, firstInCluster: forwardSet(rows, wf(falls4.first)), allDays: forwardSet(rows, wf(falls4.all)) },
    fall3: { days: wf(falls3.all).length, firstInCluster: forwardSet(rows, wf(falls3.first)) },
    pullback5: {
      triggers: pb.length, recent: pb.slice(-5).map((i) => rows[i].date),
      forward: forwardSet(rows, pb),
      deeperWithin12m: { n: depth.length, to10: reach(10), to15: reach(15), to20: reach(20), to30: reach(30) },
      buyEarlyVsWait: early,
    },
  };
}
