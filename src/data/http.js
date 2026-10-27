// fetch with a timeout, browser-like headers and simple retries.
import { sleep } from "../util.js";

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

export async function fetchWithRetry(url, { headers = {}, tries = 3, timeoutMs = 20000, method = "GET", body } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        method, body,
        headers: { "user-agent": UA, accept: "application/json,text/plain,*/*", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // not worth retrying
    } catch (e) {
      lastErr = e;
    }
    if (attempt < tries) await sleep(1000 * attempt * attempt);
  }
  throw lastErr;
}

export async function fetchJson(url, opts) {
  const res = await fetchWithRetry(url, opts);
  return res.json();
}
