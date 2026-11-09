import { test } from "node:test";
import assert from "node:assert/strict";
import { nasdaqExtras } from "../src/data/nasdaq.js";
import { parseTable } from "../src/data/constituents.js";

const others = [
  { symbol: "AAPL", name: "Apple Inc." }, { symbol: "GOOGL", name: "Alphabet Inc. (Class A)" }, { symbol: "BRK-B", name: "Berkshire Hathaway" },
  { symbol: "AZN.L", name: "AstraZeneca" }, { symbol: "ASML.AS", name: "ASML Holding" }, { symbol: "MELI-X", name: "Not Mercado" },
];

test("nasdaqExtras keeps only names the other indices miss", () => {
  const r = nasdaqExtras([
    { ticker: "AAPL", name: "Apple Inc.", sector: "Information Technology" },
    { ticker: "GOOG", name: "Alphabet Inc. (Class C)", sector: "Communication Services" }, // other share class, dropped by name
    { ticker: "AZN", name: "AstraZeneca plc", sector: "Health Care" },                   // FTSE home listing
    { ticker: "ASML", name: "ASML Holding N.V.", sector: "Information Technology" },      // Euro Stoxx home listing
    { ticker: "ARM", name: "Arm Holdings", sector: "Technology" },                        // ICB wording
    { ticker: "MELI", name: "MercadoLibre", sector: "Consumer Discretionary" },
    { ticker: "TRI", name: "Thomson Reuters", sector: "Industrials" },
    { ticker: "PDD", name: "PDD Holdings", sector: "Telecommunications" },
    { ticker: "ARM", name: "Arm Holdings plc", sector: "Technology" },                    // repeated row
    { ticker: "", name: "Footnote", sector: "" },
  ], others);
  assert.deepEqual(r.list.map((c) => c.symbol), ["ARM", "MELI", "TRI", "PDD"]);
  assert.equal(r.list[0].sector, "Information Technology");
  assert.equal(r.list[3].sector, "Communication Services");
  assert.equal(r.dropped, 5);
});

test("nasdaqExtras: share-class tickers with a dot become Yahoo dashes", () => {
  const r = nasdaqExtras([{ ticker: "FOO.A", name: "Foo Corp", sector: "Industrials" }], others);
  assert.deepEqual(r.list, [{ ticker: "FOO.A", name: "Foo Corp", sector: "Industrials", symbol: "FOO-A" }]);
});

test("parseTable reads a Nasdaq 100 style table (Ticker, Company, ICB Industry, ICB Subsector)", () => {
  const rows = Array.from({ length: 25 }, (_, i) => `<tr><td>T${i}</td><td>Co ${i}</td><td>Technology</td><td>Software</td></tr>`).join("");
  const html = `<table class="wikitable"><tr><th>Ticker</th><th>Company</th><th>ICB Industry<sup>[1]</sup></th><th>ICB Subsector</th></tr>${rows}</table>`;
  const out = parseTable(html, { symbolCol: /ticker|symbol/i, nameCol: /company|security/i, sectorCol: /gics sector|icb industry|industry|sector/i });
  assert.equal(out.length, 25);
  assert.deepEqual(out[0], { ticker: "T0", name: "Co 0", sector: "Technology" });
});
