// Which pushes reach the phone. Douglas, 10 Nov 2026: plan alerts plus a
// swing-trade alert (paper), the rest muted. Muted alerts are still logged in
// the track record and shown on the pages; only the push is skipped.
export const PROFILES = {
  // Every alert (the behaviour before 10 Nov).
  all: null,
  // Plan: monitor problems, buy tiers, crash watch, the pullback rule, your own
  // price alerts, news on your five picks; plus swing-trade orders and closes,
  // and the ranked short-term signals (Douglas, 11 Nov).
  // Results ahead for the research list (Douglas, 12 Nov: "a better signal on
  // upcoming results").
  "plan-swing": ["health", "buy", "crash", "pullback", "price", "research-pick", "swing", "short", "results"],
};

export function allowAlert(a, profile = "all") {
  const keep = PROFILES[profile];
  return !keep || keep.includes(a?.kind);
}

// The daily market summaries: under "plan-swing" only the plan lines go out
// (Mondays, or when a plan action is due within a day), as one short push.
export function summaryAllowed(profile = "all", planLines = []) {
  if (!PROFILES[profile]) return "full";
  return planLines.length ? "plan" : "none";
}
