import { test } from "node:test";
import assert from "node:assert/strict";
import { coreFundView, coreFundLine, drawdownTag, fmtGbp } from "../src/coreFund.js";

const snap = (o) => ({ level: 131.42, currency: "GBP", date: "2026-11-06", drawdownPct: -3.2, peak: 135.8, peakDate: "2026-10-06", dayPct: -0.4, weekPct: -1.1, monthPct: -2.5, ytdPct: 9.1, vs200Pct: 2.0, above200: true, ...o });

test("drawdown tags", () => {
  assert.equal(drawdownTag(-4), null);
  assert.equal(drawdownTag(-10), "Correction");
  assert.equal(drawdownTag(-20.6), "Bear market");
  assert.equal(drawdownTag(null), null);
});

test("pounds or pence", () => {
  assert.equal(fmtGbp(131.416, "GBP"), "£131.42");
  assert.equal(fmtGbp(13141.6, "GBp"), "13142p");
});

test("core fund note compares with the S&P 500", () => {
  const v = coreFundView(snap(), { drawdownPct: -5.7 });
  assert.equal(v.spGap, 2.5);
  assert.match(v.note, /^VWRP is 3\.2% below its 52-week high in pounds, a smaller fall than the S&P 500's 5\.7% in dollars/);
  assert.equal(v.price, "£131.42");
  const same = coreFundView(snap({ drawdownPct: -5.2 }), { drawdownPct: -5.7 });
  assert.match(same.note, /about the same/);
  const worse = coreFundView(snap({ drawdownPct: -8 }), { drawdownPct: -5.7 });
  assert.match(worse.note, /a bigger fall/);
  const high = coreFundView(snap({ drawdownPct: -0.2 }), null);
  assert.equal(high.note, "VWRP is at or near its 52-week high in pounds.");
  assert.equal(high.spGap, null);
});

test("missing data gives nothing", () => {
  assert.equal(coreFundView(null, null), null);
  assert.equal(coreFundView({ level: null }, null), null);
  assert.equal(coreFundLine(null), null);
});

test("digest line", () => {
  assert.equal(coreFundLine(coreFundView(snap(), null)), "Core fund (VWRP): £131.42, -3.2% from its high; week -1.1%, month -2.5%.");
});
