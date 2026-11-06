import { test } from "node:test";
import assert from "node:assert/strict";
import { momentum12_1, longTerm, entryViewNote } from "../src/research.js";

const rowsFrom = (closes, start = "2025-01-01") => closes.map((close, i) => ({ date: new Date(Date.parse(start) + i * 86400000 * 1.45).toISOString().slice(0, 10), close }));

test("12-1 momentum skips the latest month and falls back to the first bar on 251 sessions", () => {
  const c = Array.from({ length: 300 }, (_, i) => 100 + i);
  const n = 299;
  assert.equal(Math.round(momentum12_1(rowsFrom(c)) * 100) / 100, Math.round(((c[n - 21] / c[n - 252]) - 1) * 10000) / 100);
  const short = rowsFrom(Array.from({ length: 251 }, (_, i) => 100 + i)); // spans ~363 days
  assert.equal(Math.round(momentum12_1(short) * 10) / 10, Math.round(((329 / 100) - 1) * 1000) / 10);
  assert.equal(momentum12_1(rowsFrom(Array(120).fill(100))), null);
});

const f = { forwardPE: 14, trailingPE: 16, peg: 1.1, profitMargin: 0.2, roe: 0.2, revenueGrowth: 0.1, earningsGrowth: 0.12, debtToEquity: 50, targetMean: 120, recommendationMean: 2 };
const t = (offHigh, mom12_1) => ({ last: 100, offHigh, vs200: -2, rsi: 45, sma50: 101, sma200: 99, mom12_1 });

test("entry alt: a 25% discount loses its extra credit; near the high is no longer penalised", () => {
  const deep = longTerm(f, t(-25, null)), deepAlt = longTerm(f, t(-25, null), null, { entryAlt: true });
  const e = (lt) => lt.pillars.find((p) => p.key === "entry");
  assert.ok(e(deepAlt).score < e(deep).score);
  const near = longTerm(f, t(-1, null)), nearAlt = longTerm(f, t(-1, null), null, { entryAlt: true });
  assert.ok(e(nearAlt).score > e(near).score);
  assert.equal(e(near).items.length, 3, "live rule unchanged");
  assert.equal(e(longTerm(f, t(-1, 40), null, { entryAlt: true })).items.length, 4, "momentum added when known");
});

test("entryViewNote reports the would-be entry score and any verdict change", () => {
  const now = longTerm(f, t(-25, null)), alt = longTerm(f, t(-25, -20), null, { entryAlt: true });
  const v = entryViewNote(now, alt, t(-25, -20));
  assert.equal(v.mom, -20);
  assert.ok(v.entry < v.entryNow);
  assert.equal(v.changed, alt.verdict !== now.verdict);
  assert.match(v.note, /Entry would score \d+ \(now \d+\)/);
  assert.equal(entryViewNote(null, alt, null), null);
});
