import { test } from "node:test";
import assert from "node:assert/strict";
import { gicsSector, isCyclical, sectorMedians, peerFor, sectorValueNote, CYCLICAL_VALUE_CAP } from "../src/sectorValue.js";
import { longTerm } from "../src/research.js";

test("GICS, FTSE (ICB) and Yahoo sector names map onto one set", () => {
  assert.equal(gicsSector("Information Technology"), "Information Technology");
  assert.equal(gicsSector("Technology"), "Information Technology");
  assert.equal(gicsSector("Banks"), "Financials");
  assert.equal(gicsSector("Financial Services"), "Financials");
  assert.equal(gicsSector("Basic Materials"), "Materials");
  assert.equal(gicsSector("Household Goods and Home Construction"), "Consumer Discretionary");
  assert.equal(gicsSector("Something new"), null);
  assert.equal(gicsSector(null), null);
});

test("cyclical flag: Energy and Materials as a whole, memory chips, miners, housebuilders", () => {
  assert.ok(isCyclical("Energy", null));
  assert.ok(isCyclical("Basic Materials", "Agricultural Inputs"), "CF Industries");
  assert.ok(isCyclical("Information Technology", "Computer Hardware"), "Sandisk, WDC");
  assert.ok(isCyclical("Industrial Metals and Mining", null), "FTSE miner without an industry");
  assert.ok(isCyclical("Household Goods and Home Construction", null), "UK housebuilders");
  assert.ok(isCyclical("Consumer Cyclical", "Auto Manufacturers"));
  assert.equal(isCyclical("Information Technology", "Software - Infrastructure"), false);
  assert.equal(isCyclical("Consumer Staples", null), false);
});

const rows = (sector, pes, extra = {}) => pes.map((pe) => ({ sector, forwardPE: pe, ...extra }));

test("sector medians need enough peers and skip trusts and negative P/Es", () => {
  const m = sectorMedians([
    ...rows("Information Technology", [10, 20, 22, 24, 26, 28, 30, 40, -5]),
    ...rows("Technology", [25]), // Yahoo name joins the same sector
    ...rows("Utilities", [15, 16, 17]), // too few
    ...rows("Closed End Investments", [2, 2, 2, 2, 2, 2, 2, 2], { trust: true }),
  ]);
  assert.deepEqual(Object.keys(m), ["Information Technology"]);
  assert.equal(m["Information Technology"].n, 9);
  assert.equal(m["Information Technology"].pe, 25);
  assert.equal(m["Information Technology"].evToEbitda, null, "no EV/EBITDA data");
});

const tech = { last: 100, offHigh: -20, vs200: -2, rsi: 40, sma50: 99, sma200: 95 };
const strong = { profitMargin: 0.3, roe: 0.3, revenueGrowth: 0.2, earningsGrowth: 0.3, debtToEquity: 30, targetMean: 130, recommendationMean: 1.8 };

test("without peers longTerm is unchanged; at the sector median P/E scores like a fixed P/E of 20", () => {
  const f = { ...strong, forwardPE: 20 };
  assert.deepEqual(longTerm(f, tech), longTerm(f, tech, null));
  const peer = { forwardPE: 20, trailingPE: null, evToEbitda: null, cyclical: false };
  const v = (lt) => lt.pillars.find((p) => p.key === "value").score;
  assert.equal(v(longTerm(f, tech, peer)), v(longTerm(f, tech)));
});

test("a cheap P/E in an expensive sector scores well against peers; a cyclical is capped", () => {
  const f = { ...strong, sector: "Information Technology", industry: "Computer Hardware", forwardPE: 4 };
  const medians = { "Information Technology": { n: 70, pe: 24, forwardPE: 24, trailingPE: 28, evToEbitda: 18 } };
  const peer = peerFor(f, medians);
  assert.equal(peer.cyclical, true);
  const now = longTerm(f, tech), alt = longTerm(f, tech, peer);
  const v = (lt) => lt.pillars.find((p) => p.key === "value").score;
  assert.ok(v(now) > 90);
  assert.equal(v(alt), CYCLICAL_VALUE_CAP);
  const note = sectorValueNote(f, peer, now, alt);
  assert.equal(note.ratio, 0.17);
  assert.match(note.note, /83% below/);
  assert.match(note.note, /peak earnings, so value is capped at 60/);
  assert.match(note.note, /vs the Information Technology median/);
  assert.equal(note.valueNow, v(now));
  assert.equal(note.changed, alt.verdict !== now.verdict);
  // A non-cyclical at the same discount keeps its high value score.
  const sw = { ...f, industry: "Software - Infrastructure" };
  assert.ok(v(longTerm(sw, tech, peerFor(sw, medians))) > 90);
});

test("an expensive cyclical gets no peak-earnings line", () => {
  const f = { ...strong, sector: "Consumer Cyclical", industry: "Auto Manufacturers", forwardPE: 150 };
  const medians = { "Consumer Discretionary": { n: 59, pe: 18, forwardPE: 18 } };
  const peer = peerFor(f, medians);
  const note = sectorValueNote(f, peer, longTerm(f, tech), longTerm(f, tech, peer));
  assert.equal(note.cyclical, true);
  assert.doesNotMatch(note.note, /peak earnings/);
});

test("no peer note without a sector median or a score", () => {
  assert.equal(peerFor({ sector: "Utilities", forwardPE: 15 }, {}), null);
  assert.equal(peerFor({ sector: null }, { Utilities: {} }), null);
  assert.equal(sectorValueNote({}, null, null, null), null);
});

test("per-region medians: US vs Europe (UK and Euro Stoxx pooled), with a pooled fallback", async () => {
  const { regionMedians, marketOf, regionOf } = await import("../src/sectorValue.js");
  assert.equal(marketOf("HSBA.L"), "UK");
  assert.equal(marketOf("SAN.MC"), "EU");
  assert.equal(marketOf("SAP.DE"), "EU");
  assert.equal(marketOf("BRK.B"), "US", "US class shares are not European");
  assert.equal(regionOf("UK"), "Europe");
  assert.equal(regionOf("EU"), "Europe");
  assert.equal(regionOf("US"), "US");
  const all = [
    ...rows("Financials", [12, 13, 13, 14, 14, 15, 16, 18], { market: "US" }),
    ...rows("Banks", [7, 8, 9, 9], { market: "UK" }),
    ...rows("Financials", [8, 9, 10, 11], { market: "EU" }),
    ...rows("Utilities", [15, 16, 17, 18, 19, 20, 21, 22], { market: "US" }),
    ...rows("Electricity", [12, 13], { market: "UK" }),
  ];
  const pooled = sectorMedians(all), regional = regionMedians(all);
  assert.equal(regional.US.Financials.pe, 14);
  assert.equal(regional.Europe.Financials.pe, 9);
  assert.equal(regional.Europe.Utilities, undefined, "too few European utilities");
  const bank = { sector: "Banks", forwardPE: 9 };
  const eu = peerFor(bank, pooled, regional, "UK");
  assert.equal(eu.region, "Europe");
  assert.equal(eu.pe, 9);
  const us = peerFor({ sector: "Financials", forwardPE: 9 }, pooled, regional, "US");
  assert.equal(us.region, "US");
  assert.equal(us.pe, 14);
  const ut = peerFor({ sector: "Electricity", forwardPE: 12 }, pooled, regional, "UK");
  assert.equal(ut.region, null, "falls back to the pooled median");
  assert.equal(ut.pe, pooled.Utilities.pe);
  assert.deepEqual(peerFor(bank, pooled), { ...peerFor(bank, pooled, null, null) }, "old call unchanged");
  assert.equal(peerFor(bank, pooled).region, null);
  const now = longTerm({ ...strong, ...bank }, tech), alt = longTerm({ ...strong, ...bank }, tech, eu);
  const note = sectorValueNote({ ...strong, ...bank }, eu, now, alt);
  assert.match(note.note, /European Financials median of 9\.0/);
  assert.equal(note.region, "Europe");
});
