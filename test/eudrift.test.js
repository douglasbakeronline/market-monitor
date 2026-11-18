import { test } from "node:test";
import assert from "node:assert/strict";
import { euDriftCheck } from "../src/euDrift.js";
import { roundTripCost } from "../src/swingRetune.js";
import { runStock } from "../src/swingLab.js";

test("European round-trip costs: FX both ways plus purchase tax by country", () => {
  assert.equal(roundTripCost("MC.PA", "EU"), 0.007);
  assert.equal(roundTripCost("ENEL.MI", "EU"), 0.004);
  assert.equal(roundTripCost("SAN.MC", "EU"), 0.005);
  assert.equal(roundTripCost("SAP.DE", "EU"), 0.003);
  assert.equal(roundTripCost("NDA-FI.HE", "EU"), 0.003);
  assert.equal(roundTripCost("AAPL", "US"), 0.003);
  assert.equal(roundTripCost("HSBA.L", "UK"), 0.005);
});

test("runStock takes a cost override; the default is unchanged", () => {
  const rows = Array.from({ length: 320 }, (_, i) => {
    const c = 100 + i * 0.1 + (i === 280 ? 6 : i > 280 ? 6 : 0);
    return { date: new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10), open: c, high: c, low: c, close: c, volume: i === 280 ? 5000 : 1000 };
  });
  const a = runStock(rows, "US", { seed: 3 }), b = runStock(rows, "US", { seed: 3, cost: 0.01 });
  const da = a.find((t) => t.strategy === "drift" && t.kind === "signal" && !t.stop), db = b.find((t) => t.strategy === "drift" && t.kind === "signal" && !t.stop);
  assert.ok(da && db);
  assert.equal(da.date, "2020-10-07");
  assert.ok(Math.abs(da.net - db.net - 0.7) < 1e-9);
});

const tr = (kind, year, net, date = `${year}-06-01`) => ({ strategy: "drift", stop: false, kind, year: String(year), date, net });

test("EU drift check: passes only when every pre-registered test holds", () => {
  const T = [];
  for (let y = 2017; y <= 2025; y++) {
    for (let k = 0; k < 20; k++) T.push(tr("signal", y, 1.5, `${y}-0${1 + (k % 9)}-10`));
    for (let k = 0; k < 40; k++) T.push(tr("random", y, 0.8, `${y}-0${1 + (k % 9)}-10`));
  }
  const ok = euDriftCheck(T);
  assert.equal(ok.n, 180);
  assert.equal(ok.edge, 0.7);
  assert.equal(ok.yearsCounted, 9);
  assert.equal(ok.pass, true);
  // Too few trades.
  assert.equal(euDriftCheck(T.filter((t) => t.kind === "random" || t.year < "2025")).checks.sample, true);
  assert.equal(euDriftCheck(T.filter((t) => t.kind === "random" || t.year < "2024")).checks.sample, false);
  // Edge under 0.3.
  const thin = T.map((t) => (t.kind === "signal" ? { ...t, net: 1.0 } : t));
  assert.equal(euDriftCheck(thin).checks.edge, false);
  // Behind in four of nine years: fails years (needs two thirds).
  const bad = T.map((t) => (t.kind === "signal" && t.year <= "2020" ? { ...t, net: 0.5 } : t));
  const r = euDriftCheck(bad);
  assert.equal(r.yearsAhead, 5);
  assert.equal(r.checks.years, false);
  // The second half behind random fails halves.
  const late = T.map((t) => (t.kind === "signal" && t.year >= "2022" ? { ...t, net: 0.5 } : t));
  assert.equal(euDriftCheck(late).checks.halves, false);
  // Stops and other strategies are ignored.
  assert.equal(euDriftCheck([...T, { ...tr("signal", 2020, -50), stop: true }, { ...tr("signal", 2020, -50), strategy: "dip" }]).edge, 0.7);
});
