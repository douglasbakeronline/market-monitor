// Chain watchdog (run by .github/workflows/watchdog.yml).
//   node scripts/watchdog.mjs          check only; writes stale/key outputs
//   node scripts/watchdog.mjs --act    if stale: restart the chain when no run is
//                                      active, and alert (unless ALERTED=1)
// Needs GH_TOKEN for gh. DRY_RUN=1 prints the alert and never restarts.
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chainHealth, watchdogMessage } from "../src/watchdog.js";
import { notify } from "../src/notify.js";

let updated = null;
try { updated = JSON.parse(readFileSync("data.json", "utf8")).updated ?? null; } catch (e) { console.warn(`data.json unreadable: ${e.message}`); }
const h = chainHealth(updated, new Date());
console.log(h.ok ? `Chain OK: last save ${updated}, last due slot ${h.lastDue?.id} at ${h.lastDue?.at.toISOString()}.`
  : `Chain STALE: last save ${updated}; missed ${h.missed.map((s) => s.id).join(", ")}.`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `stale=${!h.ok}\nkey=${String(updated).replace(/[^0-9A-Za-z]/g, "")}\n`);

if (process.argv.includes("--act") && !h.ok) {
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
  let active = false, restarted = false;
  try {
    const runs = JSON.parse(gh("run", "list", "--workflow", "monitor.yml", "--json", "status", "--limit", "20"));
    active = runs.some((r) => ["in_progress", "queued", "waiting", "pending", "requested"].includes(r.status));
  } catch (e) { console.warn(`Could not list runs: ${e.message}`); }
  if (!active && !process.env.DRY_RUN) {
    try { gh("workflow", "run", "monitor.yml", "--ref", "main"); restarted = true; console.log("Started Market monitor."); }
    catch (e) { console.error(`Restart failed: ${e.message}`); }
  }
  if (process.env.ALERTED === "true") console.log("Already alerted for this save; no push.");
  else await notify(watchdogMessage(h, { active, restarted }));
}
