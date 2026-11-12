// Diagnostic for swing lab round 5 (added after the pre-registered run; does
// not change its verdict): how often do volume-found results days match
// (a) the hand-checked dates in data/results-dates-known.json and (b) the
// Yahoo dates in history/results-dates.json? Lists the misses.
//   node tools/runup-dates-check.mjs   -> prints JSON
import { readFile } from "node:fs/promises";
import { fetchDaily } from "../src/data/prices.js";
import { findResultsDays } from "../src/runupStudy.js";
import { sleep } from "../src/util.js";

const hand = JSON.parse(await readFile("data/results-dates-known.json", "utf8"));
const yahoo = JSON.parse(await readFile("history/results-dates.json", "utf8"));
const check = async (sets, label, after = new Set()) => {
  let n = 0, hit = 0;
  const miss = [];
  for (const [sym, dates] of sets) {
    try {
      const { rows } = await fetchDaily(sym, { range: "2y" });
      const found = new Set(findResultsDays(rows).map((i) => rows[i].date));
      for (const k of dates) {
        const i = rows.findIndex((r) => (after.has(sym) ? r.date > k : r.date >= k));
        if (i < 60 || i >= rows.length - 1) continue;
        n++;
        const ok = found.has(rows[i].date) || found.has(rows[i + 1]?.date) || found.has(rows[i - 1]?.date);
        if (ok) hit++;
        else {
          const v = (j) => Math.round((rows[j].volume / (rows.slice(j - 50, j).reduce((a, r) => a + r.volume, 0) / 50)) * 10) / 10;
          miss.push({ sym, known: k, react: rows[i].date, volX: v(i), nextVolX: v(i + 1), near: [...found].filter((d) => Math.abs(Date.parse(d) - Date.parse(k)) < 40 * 864e5) });
        }
      }
    } catch (e) { miss.push({ sym, error: e.message }); }
    await sleep(100);
  }
  return { label, n, hit, rate: n ? Math.round((hit / n) * 100) / 100 : null, miss: miss.slice(0, 40) };
};
const handSets = Object.entries(hand.dates);
const us = Object.entries(yahoo).filter(([s, d]) => !s.includes(".") && d.length).slice(0, 60);
console.log(JSON.stringify([await check(handSets, "hand-checked", new Set(hand.afterClose ?? [])), await check(us, "yahoo (first 60 US)")], null, 1));
