import { test } from "node:test";
import assert from "node:assert/strict";
import { cnbcSymbol, parseCnbcBars, quoteBar, yahooCurrency, backupNote, resetCnbcFailures } from "../src/data/cnbc.js";
import { CONFIG } from "../src/config.js";

test("cnbcSymbol maps the monitor's indices, UK, US and European symbols", () => {
  assert.equal(cnbcSymbol("^GSPC"), ".SPX");
  assert.equal(cnbcSymbol("^FTSE"), ".FTSE");
  assert.equal(cnbcSymbol("^VIX"), ".VIX");
  assert.equal(cnbcSymbol("VWRP.L"), "VWRP-GB");
  assert.equal(cnbcSymbol("AZN.L"), "AZN-GB");
  assert.equal(cnbcSymbol("BT-A.L"), "BT.A-GB");
  // London's one- and two-letter tickers carry a trailing dot (BA., RR.); on
  // CNBC "RR-GB", "SN-GB" and "AV-GB" are other, dollar-priced instruments
  // (runner, 19 Nov).
  assert.equal(cnbcSymbol("BA.L"), "BA.-GB");
  assert.equal(cnbcSymbol("RR.L"), "RR.-GB");
  assert.equal(cnbcSymbol("SN.L"), "SN.-GB");
  assert.equal(cnbcSymbol("III.L"), "III-GB");
  assert.equal(cnbcSymbol("AAPL"), "AAPL");
  assert.equal(cnbcSymbol("BRK-B"), "BRK.B");
  // European listings, checked on the runner 19 Nov: 49 of 50 Euro Stoxx 50
  // names matched Yahoo's closes exactly over 60 sessions.
  assert.equal(cnbcSymbol("MC.PA"), "MC-FR");
  assert.equal(cnbcSymbol("SAP.DE"), "SAP-DE");
  assert.equal(cnbcSymbol("MUV2.DE"), "MUV2-DE");
  assert.equal(cnbcSymbol("ASML.AS"), "ASML-NL");
  assert.equal(cnbcSymbol("ENEL.MI"), "ENEL-IT");
  assert.equal(cnbcSymbol("ITX.MC"), "ITX-ES");
  assert.equal(cnbcSymbol("ABI.BR"), "ABI-BE");
  assert.equal(cnbcSymbol("NOKIA.HE"), "NOKIA-FI");
  // Nordea had no CNBC spelling that worked; other exchanges are unchecked.
  assert.equal(cnbcSymbol("NDA-FI.HE"), null);
  assert.equal(cnbcSymbol("NESN.SW"), null);
  assert.equal(cnbcSymbol("^RUT"), null);
  assert.equal(cnbcSymbol(null), null);
  for (const w of CONFIG.world) assert.ok(cnbcSymbol(w.symbol), `world index ${w.symbol} has a mapping`);
});

test("parseCnbcBars: dates from tradeTime, numbers parsed, bad bars dropped, oldest first", () => {
  const j = { barData: { priceBars: [
    { open: "7600.1", high: "7621.78", low: "7499.4", close: "7561.67", volume: 2727332000, tradeTime: "20261113000000" },
    { open: "7590", high: "7610", low: "7580", close: "7592.40", volume: 1, tradeTime: "20261112000000" },
    { close: "", tradeTime: "20261111000000" },
    { close: "7000", tradeTime: "bad" },
  ] } };
  const rows = parseCnbcBars(j);
  assert.deepEqual(rows.map((r) => r.date), ["2026-11-12", "2026-11-13"]);
  assert.equal(rows[1].close, 7561.67);
  assert.equal(rows[1].high, 7621.78);
  assert.deepEqual(parseCnbcBars(null), []);
});

test("quoteBar reads CNBC's formatted quote (commas) as a bar for its exchange date", () => {
  const b = quoteBar({ last: "7,561.67", last_time: "2026-11-13", open: "7,616.85", high: "7,621.78", low: "7,499.40", volume: "2,727,332,000" });
  assert.deepEqual(b, { date: "2026-11-13", open: 7616.85, high: 7621.78, low: 7499.4, close: 7561.67, volume: 2727332000 });
  assert.equal(quoteBar({ last: "N/A", last_time: "2026-11-13" }), null);
  assert.equal(quoteBar(null), null);
});

test("yahooCurrency: pence and pounds kept as CNBC gives them (AZN in GBp, VWRP in GBP, as Yahoo)", () => {
  assert.equal(yahooCurrency("GBp"), "GBp");
  assert.equal(yahooCurrency("GBX"), "GBp");
  assert.equal(yahooCurrency("GBP"), "GBP");
  assert.equal(yahooCurrency("USD"), "USD");
  assert.equal(yahooCurrency(undefined), null);
});

test("weekend bars are dropped (CNBC showed Saturday bars for SpaceX)", () => {
  const rows = parseCnbcBars({ barData: { priceBars: [{ close: "136", tradeTime: "20261113000000" }, { close: "139", tradeTime: "20261114000000" }] } });
  assert.deepEqual(rows.map((r) => r.date), ["2026-11-13"]);
  assert.equal(quoteBar({ last: "139", last_time: "2026-11-14" }), null);
});

test("backupNote names indices and the core fund, counts stocks, and is null when unused", () => {
  assert.equal(backupNote([], CONFIG), null);
  const n = backupNote(["^GSPC", "VWRP.L", "AAPL", "MSFT"], CONFIG);
  assert.match(n, /Yahoo failed for S&P 500, VWRP and 2 stocks, so their prices came from the backup source/);
  assert.match(backupNote(["^FTSE"], CONFIG), /for FTSE 100, so its prices/);
});

// fetchDaily end to end with a stubbed network.
// n weekday bars ending Thu 12 Nov 2026.
const bars = (n, base = 100) => {
  const days = [];
  for (let t = Date.UTC(2026, 10, 12); days.length < n; t -= 86400e3) if (![0, 6].includes(new Date(t).getUTCDay())) days.unshift(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
  return days.map((d, i) => ({ open: String(base), high: String(base + 1), low: String(base - 1), close: String(base + i / 100), volume: 5, tradeTime: `${d}000000` }));
};
function stub(handler) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => handler(String(url));
  return () => { globalThis.fetch = real; };
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

test("fetchDaily falls back to CNBC when Yahoo fails, and records the symbol", async () => {
  resetCnbcFailures();
  const { fetchDaily, backupSymbols } = await import("../src/data/prices.js");
  const restore = stub((u) => {
    if (u.includes("yahoo.com")) return json({}, 403);
    if (u.includes("charts/1Y.json")) return json({ barData: { priceBars: bars(250, 7000) } });
    if (u.includes("restQuote")) return json({ FormattedQuoteResult: { FormattedQuote: [{ last: "7,561.67", last_time: "2026-11-13", currencyCode: "USD", shortName: "S&P 500" }] } });
    return json({}, 404);
  });
  try {
    const r = await fetchDaily("^GSPC", { range: "10y" });
    assert.equal(r.source, "cnbc");
    assert.equal(r.rows.length, 251, "the quote's newer day is appended");
    assert.equal(r.rows.at(-1).close, 7561.67);
    assert.equal(r.tz, "America/New_York");
    assert.ok(backupSymbols().includes("^GSPC"));
    await assert.rejects(fetchDaily("AAPL", { backup: false }), /403/);
  } finally { restore(); }
});

test("fetchDaily backup: a UK fund in pounds stays in pounds; a UK price with no currency is refused", async () => {
  resetCnbcFailures();
  const { fetchDaily } = await import("../src/data/prices.js");
  let cur = "GBP";
  const restore = stub((u) => {
    if (u.includes("yahoo.com")) return json({}, 403);
    if (u.includes("charts/1Y.json")) return json({ barData: { priceBars: bars(60, 1.2) } });
    if (u.includes("restQuote")) return json({ FormattedQuoteResult: { FormattedQuote: [cur ? { last: "1.3", last_time: "2026-11-13", currencyCode: cur } : { last: "1.3", last_time: "2026-11-13" }] } });
    return json({}, 404);
  });
  try {
    const r = await fetchDaily("VWRP.L", { range: "2y" });
    assert.equal(r.currency, "GBP");
    assert.equal(r.rows.at(-1).close, 1.3);
    assert.equal(r.rows[0].close, 1.2);
    cur = null;
    await assert.rejects(fetchDaily("AZN.L", { range: "2y" }), /403/, "falls through to the Yahoo error");
  } finally { restore(); resetCnbcFailures(); }
});

test("cnbcTz: European listings use their exchange's zone for the live bar", async () => {
  const { cnbcTz } = await import("../src/data/cnbc.js");
  assert.equal(cnbcTz("MC.PA"), "Europe/Paris");
  assert.equal(cnbcTz("SAP.DE"), "Europe/Berlin");
  assert.equal(cnbcTz("NOKIA.HE"), "Europe/Helsinki");
  assert.equal(cnbcTz("AZN.L"), "Europe/London");
  assert.equal(cnbcTz("AAPL"), "America/New_York");
  assert.equal(cnbcTz("^FTSE"), "Europe/London");
  assert.equal(cnbcTz("^GSPC"), "America/New_York");
});
