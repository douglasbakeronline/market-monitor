// Rebalancing rule (proposed 9 Nov, research log; agreed by Douglas 10 Nov).
// The pots panel uses these helpers in the browser (values never leave it);
// the Sunday digest only carries a reminder, as pot values are private.

export const REBALANCE = {
  bandPts: 5,        // act outside the twice-yearly limit only when a pot is this many points off target
  maxPerYear: 2,     // rebalances a year at most (unless a pot is bandPts+ off)
  pickMaxPct: 3,     // up to 3% of the portfolio per pick (no tranche beyond it)
  pickCeilingPct: 5, // trim a pick that grows past this...
  pickTrimToPct: 3,  // ...back to this
};

// Distinct days with a trade logged under the "rebalance" rule in the 365 days
// up to `today` (YYYY-MM-DD).
export function rebalancesInYear(trades = [], today) {
  const from = new Date(Date.parse(today) - 365 * 86400000).toISOString().slice(0, 10);
  return new Set(trades.filter((t) => t?.rule === "rebalance" && t.date > from && t.date <= today).map((t) => t.date)).size;
}

// Sunday digest reminder (the monitor cannot see pot values).
export const digestLine = (rules = REBALANCE) =>
  `Rebalancing check: open the pots panel on the Dashboard. Act only if a pot is ${rules.bandPts}+ points off target (otherwise at most ${rules.maxPerYear === 2 ? "twice" : `${rules.maxPerYear} times`} a year), new money and dividends before selling; trim any pick past ${rules.pickCeilingPct}% of the portfolio back to ${rules.pickTrimToPct}%.`;

// New money that would bring every pot with a target back to it without
// selling anything. The most overweight pot sets the new total; the others are
// filled up to their share of it. Pots with a 0% target (swing, paper only) are
// left out: the plan moves that money by a switch, not with new money.
export function topUpToTarget(values = {}, targets = {}) {
  const keys = Object.keys(targets).filter((k) => targets[k] > 0);
  const tSum = keys.reduce((a, k) => a + targets[k], 0);
  const v = (k) => (Number.isFinite(values[k]) && values[k] > 0 ? values[k] : 0);
  const total = keys.reduce((a, k) => a + v(k), 0);
  if (!keys.length || !total) return null;
  const newTotal = Math.max(...keys.map((k) => v(k) / (targets[k] / tSum)));
  const split = {};
  for (const k of keys) {
    const add = (targets[k] / tSum) * newTotal - v(k);
    if (add >= 0.5) split[k] = Math.round(add);
  }
  const newMoney = Object.values(split).reduce((a, x) => a + x, 0);
  return { total, newTotal, newMoney, split, onTarget: newMoney === 0 };
}

// Months of top-ups the new money would take (null without a monthly figure).
export const monthsOfTopUps = (newMoney, monthly) => (monthly > 0 && newMoney > 0 ? Math.ceil(newMoney / monthly) : newMoney > 0 ? null : 0);

// Each pick's net amount invested (buys minus sells in the picks pot, from the
// trade log) as a share of the pots' total. At cost, not today's value.
export function pickSizes(trades = [], potsTotal = 0, rules = REBALANCE) {
  if (!(potsTotal > 0)) return [];
  const by = {};
  for (const t of trades) {
    if (t?.pot !== "picks" || t.amount == null || !t.ticker) continue;
    by[t.ticker] = (by[t.ticker] || 0) + (t.action === "sell" ? -t.amount : t.amount);
  }
  return Object.entries(by)
    .filter(([, a]) => a > 0.5)
    .map(([ticker, amount]) => {
      const pct = (amount / potsTotal) * 100;
      const status = pct > rules.pickCeilingPct ? "ceiling" : pct >= rules.pickMaxPct - 0.05 ? "full" : "room";
      return { ticker, amount: Math.round(amount), pct, status };
    })
    .sort((a, b) => b.pct - a.pct);
}

// One plain line on the pick sizes for the panel.
export function pickSizeLine(sizes, rules = REBALANCE) {
  if (!sizes.length) return null;
  const over = sizes.filter((s) => s.status === "ceiling");
  const full = sizes.filter((s) => s.status === "full");
  const f = (s) => `${s.ticker} ${s.pct.toFixed(1)}%`;
  if (over.length) return `Past the ${rules.pickCeilingPct}% ceiling: ${over.map(f).join(", ")}. The rule says trim back to ${rules.pickTrimToPct}%.`;
  if (full.length) return `At the ${rules.pickMaxPct}% maximum, so no further tranches: ${full.map(f).join(", ")}.`;
  return `Every pick is below the ${rules.pickMaxPct}% maximum (largest ${f(sizes[0])}).`;
}

// The core pot is all VWRP, so between updates its value can follow the fund:
// scale it by VWRP's move since the values were saved (`pf.vwrpAt`, recorded at
// save time). The reserve is cash and stays as saved; picks stay as saved too
// (their mix is unknown here). Returns null when there is nothing to estimate.
export function coreEstimate(pf, core = null) {
  const at = pf?.vwrpAt, now = core?.level;
  if (!(pf?.core > 0) || !(at?.level > 0) || !(now > 0) || !core?.date || core.date <= at.date) return null;
  const factor = now / at.level;
  const pct = (factor - 1) * 100;
  if (Math.abs(pct) < 0.05) return null;
  return { value: Math.round(pf.core * factor), pct, since: at.date, asOf: core.date };
}
