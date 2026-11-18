import { test } from "node:test";
import assert from "node:assert/strict";
import { shortName } from "../src/util.js";

test("shortName drops legal suffixes, as on the Trends page", () => {
  assert.equal(shortName("Cboe Global Markets, Inc."), "Cboe Global Markets");
  assert.equal(shortName("The Kroger Co."), "The Kroger");
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
