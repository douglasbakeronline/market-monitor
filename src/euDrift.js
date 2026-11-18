// Swing lab follow-up (b), 18 Nov 2026: post-results drift on Euro Stoxx 50
// names. The short-term pot trades drift on S&P 500 and FTSE 100 names only;
// the roadmap said Europe needs its own backtest before it could join.
//
// PRE-REGISTERED (written and committed before the run, no tuning after):
// the swing lab's drift rule unchanged (a +4% day on 3x the previous 50
// sessions' volume, buy the next open, hold 20 sessions, no stop), over the
// 50 current Euro Stoxx 50 members, ten years of Yahoo bars, against random
// 20-session holds in the same stocks, after costs: the 0.15% FX fee each way
// plus purchase tax (France 0.4%, Italy 0.1%, Spain 0.2%; `roundTripCost()`).
//
// The question is not whether drift clears the swing lab's full bar (US and
// UK did not either: +0.58 points, ahead in 6 of 9 years), but whether Europe
// shows the same evidence the pot already rests on. EU_BAR, all must hold:
//   edge     signal average minus random average at least +0.3 points
//   positive signal average after costs above zero
//   sample   150+ signal trades
//   years    ahead of random in at least two thirds of the years with 20+
//            signal trades
//   halves   ahead of random in both halves of the sample (split at the
//            median signal date)
// Only if all hold would Claude propose (to Douglas) adding Europe to the
// pot's universe. The full LAB_BAR verdict is reported alongside. The dip
// (bounce) and breakout rules are run too, as information only.
import { r2 } from "./util.js";

export const EU_BAR = { minEdge: 0.3, minTrades: 150, yearShare: 2 / 3, minYearTrades: 20 };

const mean = (xs) => (xs.length ? xs.reduce((a, t) => a + t.net, 0) / xs.length : null);

// trades: runStock() output (strategy "drift", stop false, kinds "signal" and
// "random"). Returns the checks and the figures behind them.
export function euDriftCheck(trades, bar = EU_BAR) {
  const sig = trades.filter((t) => t.strategy === "drift" && !t.stop && t.kind === "signal");
  const rnd = trades.filter((t) => t.strategy === "drift" && !t.stop && t.kind === "random");
  const S = mean(sig), R = mean(rnd);
  const edge = S != null && R != null ? r2(S - R) : null;
  const years = [...new Set(sig.map((t) => t.year))].sort().map((y) => {
    const a = sig.filter((t) => t.year === y), b = rnd.filter((t) => t.year === y);
    return { year: y, n: a.length, avg: a.length ? r2(mean(a)) : null, base: b.length ? r2(mean(b)) : null, edge: a.length && b.length ? r2(mean(a) - mean(b)) : null };
  });
  const counted = years.filter((y) => y.n >= bar.minYearTrades && y.edge != null);
  const ahead = counted.filter((y) => y.edge > 0).length;
  const dates = sig.map((t) => t.date).sort(), mid = dates[Math.floor(dates.length / 2)];
  const half = (f) => {
    const a = sig.filter(f), b = rnd.filter(f);
    return { n: a.length, edge: a.length && b.length ? r2(mean(a) - mean(b)) : null };
  };
  const halves = mid ? [half((t) => t.date < mid), half((t) => t.date >= mid)] : [];
  const checks = {
    edge: edge != null && edge >= bar.minEdge,
    positive: S != null && S > 0,
    sample: sig.length >= bar.minTrades,
    years: counted.length > 0 && ahead / counted.length >= bar.yearShare,
    halves: halves.length === 2 && halves.every((h) => h.edge != null && h.edge > 0),
  };
  return { n: sig.length, avg: S == null ? null : r2(S), random: R == null ? null : r2(R), edge, win: sig.length ? Math.round((sig.filter((t) => t.net > 0).length / sig.length) * 100) : null,
    years, yearsAhead: ahead, yearsCounted: counted.length, halves, checks, pass: Object.values(checks).every(Boolean) };
}
