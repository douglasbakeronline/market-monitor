import { test } from "node:test";
import assert from "node:assert/strict";
import { shortName } from "../src/util.js";

test("shortName drops legal suffixes, as on the Trends page", () => {
  assert.equal(shortName("Cboe Global Markets, Inc."), "Cboe Global Markets");
  assert.equal(shortName("The Kroger Co."), "Kroger");
  assert.equal(shortName("Deutsche Bank Aktiengesellschaft"), "Deutsche Bank");
  assert.equal(shortName("Arm Holdings plc"), "Arm");
  assert.equal(shortName("Strategy Inc"), "Strategy");
  assert.equal(shortName("Tesco PLC"), "Tesco");
  assert.equal(shortName("Wells Fargo & Company"), "Wells Fargo");
  assert.equal(shortName("Eli Lilly and Company"), "Eli Lilly");
  assert.equal(shortName("Vertiv Holdings Co"), "Vertiv");
  assert.equal(shortName("JPMorgan Chase & Co."), "JPMorgan Chase");
  assert.equal(shortName("Vodafone Group Public Limited Company"), "Vodafone Group");
  assert.equal(shortName("Nvidia"), "Nvidia");
  assert.equal(shortName("SE"), "SE"); // never to nothing
  assert.equal(shortName(null), "");
});

// 18 Nov (22:41): the Dashboard read "DIS The Walt Disney" and "SSE SSE".
test("shortName drops a leading The and a trailing Companies", () => {
  assert.equal(shortName("The Walt Disney Company"), "Walt Disney");
  assert.equal(shortName("The Coca-Cola Company"), "Coca-Cola");
  assert.equal(shortName("The Home Depot, Inc."), "Home Depot");
  assert.equal(shortName("The TJX Companies, Inc."), "TJX");
  assert.equal(shortName("The Estée Lauder Companies Inc."), "Estée Lauder");
  assert.equal(shortName("The Sage Group plc"), "Sage Group");
  assert.equal(shortName("The Procter & Gamble Company"), "Procter & Gamble");
  assert.equal(shortName("The"), "The"); // never to nothing
});

test("shortName with a ticker gives nothing when the name only repeats it", () => {
  assert.equal(shortName("SSE plc", "SSE"), "");
  assert.equal(shortName("SSE plc", "SSE.L"), "");
  assert.equal(shortName("CSX Corporation", "csx"), "");
  assert.equal(shortName("HP Inc.", "HPQ"), "HP");
  assert.equal(shortName("Target Corporation", "TGT"), "Target");
});
