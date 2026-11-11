// One digest line for every paper book (Douglas, 11 Nov: "track
// everything"), e.g. "Paper books since start: plan +1.2% vs all-VWRP +1.5%;
// Buffett +2.0% (S&P +1.1%); momentum S&P -0.8%, FTSE +0.4%; swing -2.4%
// (S&P -0.8%); drift +0.3%. Buffett lens: 8 in the buy zone, first month
// scored from 11 Dec." Null when nothing has started.
import { summariseLensEvents } from "./buffett.js";

const pct = (x) => (Math.abs(x) < 0.05 ? "0.0%" : `${x > 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}%`);

export function paperDigestLine({ plan, buffett, momentum, swing, drift, lensEvents } = {}) {
  const parts = [];
  const pv = plan?.variants;
  if (pv?.agreed?.started && pv?.vwrp?.started) {
    const r = (v) => (v.value / plan.rules.equity0 - 1) * 100;
    const extra = ["weakHold", "reitValue", "buffettPot", "momentumPot"].filter((k) => pv[k]?.started).map((k) => `${{ weakHold: "with the weak-results hold", reitValue: "with the REIT view", buffettPot: "with Buffett picks", momentumPot: "with momentum picks" }[k]} ${pct(r(pv[k]))}`);
    parts.push(`plan ${pct(r(pv.agreed))} vs all-VWRP ${pct(r(pv.vwrp))}${extra.length ? ` (${extra.join(", ")})` : ""}`);
  }
  if (buffett?.trades?.length) parts.push(`Buffett ${pct((buffett.value / buffett.rules.equity0 - 1) * 100)}${buffett.bench ? ` (S&P ${pct(buffett.bench.pct)})` : ""}`);
  const m = momentum?.markets;
  if (m?.US?.lastRebalance) parts.push(`momentum S&P ${pct((m.US.value / momentum.rules.equity0 - 1) * 100)}, FTSE ${pct((m.UK.value / momentum.rules.equity0 - 1) * 100)}`);
  if (swing?.start) parts.push(`swing ${pct(swing.returnPct)}${swing.sp?.pct != null ? ` (S&P ${pct(swing.sp.pct)})` : ""}`);
  if (drift?.start) parts.push(`drift ${pct(drift.returnPct)}`);
  let lens = "";
  if (lensEvents?.length) {
    const s = summariseLensEvents(lensEvents).zone, h = s.h[21];
    lens = ` Buffett lens: ${s.open} in the buy zone${h.n ? `; a month after joining, ${h.n} scored ${pct(h.vsIdx)} vs their index on average` : ""}.`;
  }
  if (!parts.length && !lens) return null;
  return `${parts.length ? `Paper books since start: ${parts.join("; ")}.` : ""}${lens}`.trim();
}
