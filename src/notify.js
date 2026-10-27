// Push notifications via ntfy. Uses the JSON publish API so titles and bodies
// can contain any characters. Retries and reports failure instead of
// silently dropping the alert. DRY_RUN=1 prints instead of sending.
import { CONFIG } from "./config.js";
import { sleep } from "./util.js";

const PRIORITY = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };

export async function notify({ title, body, priority = "default", tags = "bar_chart", click = CONFIG.dashboardUrl }) {
  const topic = process.env.NTFY_TOPIC;
  if (process.env.DRY_RUN || !topic) {
    console.log(`\n[${process.env.DRY_RUN ? "dry run" : "no NTFY_TOPIC"}] ${title}\n${body}\n`);
    return true;
  }
  const payload = JSON.stringify({
    topic, title, message: body, priority: PRIORITY[priority] ?? 3,
    tags: String(tags).split(",").filter(Boolean), click,
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://ntfy.sh", { method: "POST", body: payload, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15000) });
      if (res.ok) return true;
      console.warn(`ntfy returned ${res.status} (attempt ${attempt})`);
    } catch (e) {
      console.warn(`ntfy failed (attempt ${attempt}): ${e.message}`);
    }
    await sleep(2000 * attempt);
  }
  console.error(`Notification NOT delivered: ${title}`);
  return false;
}
