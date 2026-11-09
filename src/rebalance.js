// Rebalancing view for the Dashboard's private pots panel (browser only; the
// values never leave the viewer's browser). Display only: the rebalancing rule
// proposed on 9 Nov (research log) is waiting on Douglas, so nothing here
// changes a signal or an alert.

export const REBALANCE = {
  bandPts: 5,        // proposed: act only when a pot is this many points off target
  pickMaxPct: 3,     // agreed: up to 3% of the portfolio per pick (no tranche beyond it)
  pickCeilingPct: 5, // proposed: trim a pick that grows past this...
  pickTrimToPct: 3,  // ...back to this
};

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
  if (over.length) return `Past the proposed ${rules.pickCeilingPct}% ceiling: ${over.map(f).join(", ")}. If the ceiling is agreed, trim back to ${rules.pickTrimToPct}%.`;
  if (full.length) return `At the ${rules.pickMaxPct}% maximum, so no further tranches: ${full.map(f).join(", ")}.`;
  return `Every pick is below the ${rules.pickMaxPct}% maximum (largest ${f(sizes[0])}).`;
}
