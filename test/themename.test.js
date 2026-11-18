import { test } from "node:test";
import assert from "node:assert/strict";
import { themeName } from "../src/themes.js";
import { parseYahoo } from "../src/data/prices.js";
import { shortName } from "../src/util.js";

// 18 Nov: the Trends page showed Yahoo's chart shortName, which is cut at about
// 31 characters and, for London lines, is the register's share-class name
// ("ASTRAZENECA PLC ORD SHS $0.25", "Vertex Pharmaceuticals Incorpor").
test("themeName prefers the scan's name, then Yahoo's full name, then its short one", () => {
  const scan = new Map([["AZN.L", "AstraZeneca PLC"]]);
  assert.equal(themeName("AZN.L", { name: "ASTRAZENECA PLC ORD SHS $0.25", longName: "AstraZeneca PLC" }, scan), "AstraZeneca PLC");
  assert.equal(themeName("VRTX", { name: "Vertex Pharmaceuticals Incorpor", longName: "Vertex Pharmaceuticals Incorporated" }, scan), "Vertex Pharmaceuticals Incorporated");
  assert.equal(themeName("XBI", { name: "State Street SPDR S&P Biotech E", longName: null }, scan), "State Street SPDR S&P Biotech E");
  assert.equal(themeName("ZZZ", {}, null), "ZZZ");
});

test("parseYahoo keeps the full name beside the short one", () => {
  const res = { meta: { shortName: "Taiwan Semiconductor Manufactur", longName: "Taiwan Semiconductor Manufacturing Company Limited" },
    timestamp: [Date.parse("2026-11-17T15:00:00Z") / 1000], indicators: { quote: [{ close: [100] }] } };
  const p = parseYahoo(res);
  assert.equal(p.name, "Taiwan Semiconductor Manufactur");
  assert.equal(p.longName, "Taiwan Semiconductor Manufacturing Company Limited");
});

test("shortName also drops A/S and LLC", () => {
  assert.equal(shortName("Novo Nordisk A/S"), "Novo Nordisk");
  assert.equal(shortName("Vertiv Holdings, LLC"), "Vertiv");
  assert.equal(shortName("Taiwan Semiconductor Manufacturing Company Limited"), "Taiwan Semiconductor Manufacturing");
});
