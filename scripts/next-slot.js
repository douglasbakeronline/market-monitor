// Prints GitHub Actions outputs for the next scheduled slot:
//   slot=<id>  wait=<seconds>  within=<true|false>
// "within" is true when the slot is close enough for this job to sleep until
// it (jobs are capped at 6 hours, so we allow up to 5h40m).
import { appendFileSync } from "node:fs";
import { nextSlot } from "../src/schedule.js";

const MAX_WAIT = 340 * 60;
const n = nextSlot(new Date());
const out = { slot: n?.id ?? "", at: n?.at.toISOString() ?? "", wait: String(n?.waitSec ?? 0), within: String(!!n && n.waitSec <= MAX_WAIT) };
const lines = Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
console.log(lines.trim());
