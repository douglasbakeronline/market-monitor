import { test } from "node:test";
import assert from "node:assert/strict";
import { EUROSTOXX_FALLBACK, euroStoxxFromRows, nameKey, industryToGics } from "../src/data/eurostoxx.js";
import { parseTable } from "../src/data/constituents.js";
import { gicsSector } from "../src/sectorValue.js";

test("fallback list: 50 unique Yahoo symbols with GICS sectors", () => {
  assert.equal(EUROSTOXX_FALLBACK.length, 50);
  assert.equal(new Set(EUROSTOXX_FALLBACK.map((c) => c.symbol)).size, 50);
  for (const c of EUROSTOXX_FALLBACK) {
    assert.match(c.symbol, /\.(DE|PA|AS|MI|MC|BR|HE)$/, c.symbol);
    assert.equal(gicsSector(c.sector), c.sector, `${c.name} sector maps to itself`);
  }
});

test("nameKey ignores legal forms, accents and punctuation", () => {
  assert.equal(nameKey("L'Oréal S.A."), nameKey("L'Oreal"));
  assert.equal(nameKey("SAP SE"), nameKey("SAP"));
  assert.equal(nameKey("Siemens AG"), nameKey("Siemens"));
});

test("euroStoxxFromRows: known names keep fallback symbols; new ones get a suffix from the listing", () => {
  const r = euroStoxxFromRows([
    { ticker: "SAP", name: "SAP SE", sector: "Software", exchange: "Xetra" },
    { ticker: "SAN", name: "Sanofi", sector: "Pharmaceuticals", exchange: "Euronext Paris" },
    { ticker: "SAN", name: "Banco Santander, S.A.", sector: "Banking", exchange: "Bolsa de Madrid" },
    { ticker: "MUV2", name: "Münchener Rückversicherungs-Gesellschaft", sector: "Insurance", exchange: "Xetra" },
    { ticker: "NEWCO", name: "Newco Industrie", sector: "Industrial engineering", exchange: "Euronext Amsterdam" },
    { ticker: "ODD", name: "Odd Plc", sector: "Banking", exchange: "Nasdaq Stockholm" },
    { ticker: "SAP", name: "SAP", sector: "Software", exchange: "Xetra" },
  ]);
  assert.deepEqual(r.list.map((c) => c.symbol), ["SAP.DE", "SAN.PA", "SAN.MC", "MUV2.DE", "NEWCO.AS"]);
  assert.equal(r.list.find((c) => c.symbol === "NEWCO.AS").sector, "Industrials");
  assert.deepEqual(r.fresh, ["NEWCO.AS"]);
  assert.deepEqual(r.unplaced, ["Odd Plc"]);
});

test("industryToGics covers common wordings", () => {
  assert.equal(industryToGics("Banking"), "Financials");
  assert.equal(industryToGics("Semiconductors"), "Information Technology");
  assert.equal(industryToGics("Automotive"), "Consumer Discretionary");
  assert.equal(industryToGics("Something else"), null);
});

test("parseTable picks up the listing column when asked", () => {
  const rows = Array.from({ length: 25 }, (_, i) => `<tr><td>T${i}</td><td>Xetra</td><td>Name ${i}</td><td>Banking</td></tr>`).join("");
  const html = `<table class="wikitable"><tr><th>Ticker</th><th>Main listing</th><th>Name</th><th>Industry</th></tr>${rows}</table>`;
  const out = parseTable(html, { symbolCol: /ticker/i, nameCol: /^name/i, sectorCol: /industry/i, exchangeCol: /listing/i });
  assert.equal(out.length, 25);
  assert.deepEqual(out[0], { ticker: "T0", name: "Name 0", sector: "Banking", exchange: "Xetra" });
});
