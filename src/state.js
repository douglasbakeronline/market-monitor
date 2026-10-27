// Persistence. Real runs write to the repo root (committed by the workflow).
// DRY_RUN=1 reads the real files but writes to ./dry-run/ so nothing is
// overwritten and nothing is sent.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const outDir = () => (process.env.DRY_RUN ? "dry-run" : ".");

export async function readJson(file, fallback) {
  for (const p of [path.join(outDir(), file), file]) {
    try { return JSON.parse(await readFile(p, "utf8")); } catch { /* try next */ }
  }
  return fallback;
}

export async function writeJson(file, data, pretty = false) {
  const p = path.join(outDir(), file);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, pretty ? 2 : 0) + "\n");
}

const DEFAULT_STATE = {
  buyTier: {}, watchTier: {}, greedActive: false, trimActive: false, fearNoDipActive: false,
  summarySent: {}, digestSent: null, fearLog: {}, research: {}, health: {}, lastGood: {},
};

export async function loadState() {
  const s = await readJson("state.json", {});
  const state = { ...structuredClone(DEFAULT_STATE), ...s };
  // Migrate from the original single-market state.
  if (s.lastBuyTier != null && !s.buyTier) state.buyTier = { US: s.lastBuyTier };
  delete state.lastBuyTier;
  delete state.priceCache;
  return state;
}

export const saveState = (s) => writeJson("state.json", s, true);
