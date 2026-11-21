import { test } from "node:test";
import assert from "node:assert/strict";
import { depthEpisodes, depthSummary, tierDepth, depthLine } from "../src/tierDepth.js";

const day = (i) => new Date(Date.UTC(2000, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const rowsOf = (closes) => closes.map((close, i) => ({ date: day(i), close }));
// Flat at 100, down a point a session to `low` - 0.5, straight back up (half
// points keep every close off the exact tier levels).
const dip = (low) => {
  const c = [];
  for (let k = 1; k <= 100 - low; k++) c.push(100 - k - 0.5);
  for (let k = 1; k <= 100 - low; k++) c.push(low - 0.5 + k);
  return c.concat(Array(30).fill(100));
};

test("depth episodes: first close at each level, trough and re-arm", () => {
  const rows = rowsOf([...Array(260).fill(100), ...dip(78)]);
  const eps = depthEpisodes(rows);
  assert.equal(eps.length, 1);
  const e = eps[0];
  assert.equal(e.start, rows[269].date, "first close at -10 is the 10th down session (89.5)");
  assert.equal(e.reached[-15].sessions, 5);
  assert.equal(e.reached[-20].sessions, 10);
  assert.equal(e.reached[-30], undefined);
  assert.equal(e.trough, -22.5);
  // Back within 5% at 95.5, 18 sessions after the trough (77.5 at bar 281).
  assert.equal(e.rearmed, rows[281 + 18].date);
  assert.equal(e.sessions, 299 - 269);
  assert.equal(e.open, false);
});

test("depth summary: share going deeper from each level, sessions between them", () => {
  const rows = rowsOf([...Array(260).fill(100), ...dip(88), ...Array(260).fill(100), ...dip(78), ...Array(260).fill(100), ...dip(84)]);
  const s = depthSummary(depthEpisodes(rows));
  assert.equal(s[-10].n, 3);
  assert.equal(s[-10].deeper[-15].n, 2);
  assert.equal(s[-10].deeper[-20].n, 1);
  assert.equal(s[-10].deeper[-30].n, 0);
  assert.equal(s[-10].deeper[-15].sessions, 5);
  assert.equal(s[-10].trough, -16.5);
  assert.equal(s[-15].n, 2);
  assert.equal(s[-15].deeper[-20].n, 1);
});

test("an open fall at the end is reported but kept out of the counts", () => {
  const rows = rowsOf([...Array(260).fill(100), ...dip(85), ...Array(260).fill(100), 99, 97, 94, 91, 89, 88]);
  const t = tierDepth(rows);
  assert.equal(t.episodes, 1);
  assert.equal(t.fromLevel[-10].n, 1);
  assert.equal(t.open.trough, -12);
  assert.equal(t.open.rearmed, null);
});

test("from: episodes starting before the sample start are ignored", () => {
  const rows = rowsOf([...Array(260).fill(100), ...dip(85), ...Array(260).fill(100), ...dip(80)]);
  assert.equal(tierDepth(rows).episodes, 2);
  assert.equal(tierDepth(rows, { from: rows[400].date }).episodes, 1);
});

const sample = {
  from: "1950-01-03",
  fromLevel: {
    "-10": { n: 24, deeper: { "-15": { n: 12, sessions: 17 }, "-20": { n: 7, sessions: 40 }, "-30": { n: 3, sessions: 120 } }, trough: -15.4, rearm: 90 },
    "-15": { n: 12, deeper: { "-20": { n: 7, sessions: 22 }, "-30": { n: 3, sessions: 90 } }, trough: -21.2, rearm: 160 },
    "-20": { n: 4, deeper: { "-30": { n: 3, sessions: 60 } }, trough: -33, rearm: 400 },
  },
};

test("depth line: from the deepest tier reached, in plain words", () => {
  assert.equal(depthLine(sample, -11.6, { name: "the S&P 500" }),
    "Of 24 falls since 1950 that closed at −10%, the S&P 500 went on to −15% in 12 (about 3 weeks later, median), −20% in 7 and −30% in 3. The median low was −15%; it took a median of about 4 months to get back within 5% of its high.");
  assert.match(depthLine(sample, -16, { name: "the S&P 500" }), /^Of 12 falls since 1950 that closed at −15%, the S&P 500 went on to −20% in 7 \(about 4 weeks later, median\) and −30% in 3\./);
});

test("depth line: nothing above the first tier, at the last tier, or on a thin sample", () => {
  assert.equal(depthLine(sample, -8), null);
  assert.equal(depthLine(sample, -31), null);
  assert.equal(depthLine(sample, -21), null, "4 episodes from -20 is too few");
  assert.equal(depthLine(null, -12), null);
});
