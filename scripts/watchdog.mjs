// Chain watchdog (run by .github/workflows/watchdog.yml).
//   node scripts/watchdog.mjs          check only; writes <job>_stale / <job>_key outputs
//   node scripts/watchdog.mjs --act    for each stale job: restart it when no run is
//                                      active, and alert (unless ALERTED_<JOB>=true)
// Jobs: monitor (data.json per slot) and scan (scan.json each weeknight).
// Needs GH_TOKEN for gh. DRY_RUN=1 prints the alerts and never restarts.
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chainHealth, watchdogMessage, scanHealth, scanMessage } from "../src/watchdog.js";
import { notify } from "../src/notify.js";

const updatedOf = (file) => {
  try { return JSON.parse(readFileSync(file, "utf8")).updated ?? null; } catch (e) { console.warn(`${file} unreadable: ${e.message}`); return null; }
};
const now = new Date();
const jobs = [
  { name: "monitor", workflow: "monitor.yml", h: chainHealth(updatedOf("data.json"), now), message: watchdogMessage },
  { name: "scan", workflow: "scan.yml", h: scanHealth(updatedOf("scan.json"), now), message: scanMessage },
];
let out = "";
for (const j of jobs) {
  const due = j.h.lastDue?.at ?? j.h.lastDue;
  console.log(`${j.name}: ${j.h.ok ? "OK" : "STALE"} (last save ${j.h.updated}, last due ${due ? new Date(due).toISOString() : "none"}${j.h.missed?.length ? `, missed ${j.h.missed.map((s) => s.id).join(", ")}` : ""})`);
  out += `${j.name}_stale=${!j.h.ok}\n${j.name}_key=${String(j.h.updated).replace(/[^0-9A-Za-z]/g, "")}\n`;
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);

if (process.argv.includes("--act")) {
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
  for (const j of jobs.filter((x) => !x.h.ok)) {
    let active = false, restarted = false;
    try {
      const runs = JSON.parse(gh("run", "list", "--workflow", j.workflow, "--json", "status", "--limit", "20"));
      active = runs.some((r) => ["in_progress", "queued", "waiting", "pending", "requested"].includes(r.status));
    } catch (e) { console.warn(`Could not list ${j.workflow} runs: ${e.message}`); }
    if (!active && !process.env.DRY_RUN) {
      try { gh("workflow", "run", j.workflow, "--ref", "main"); restarted = true; console.log(`Started ${j.workflow}.`); }
      catch (e) { console.error(`Restart of ${j.workflow} failed: ${e.message}`); }
    }
    if (process.env[`ALERTED_${j.name.toUpperCase()}`] === "true") console.log(`Already alerted for this ${j.name} save; no push.`);
    else await notify(j.message(j.h, { active, restarted }));
  }
}
