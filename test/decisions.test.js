import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDecisions, decisionsLine, firstSentence, inlineHtml, plain } from "../src/decisions.js";

const MD = `# Roadmap

## Waiting on Douglas
- **Score EV/EBITDA against sector peers? (10 Nov late)** Like P/E since 10 Nov. Measured on real data: 46 of 541 change.
- OK to keep the five pick names in the public repo? Alternative: load the plan from the browser.
- Optional \`FINNHUB_KEY\` secret.
- **REITs on cash flow, not P/E (10 Nov):** a display-only *REIT view* now shows it. OK to use it?
  continued on a second line.
- His own research list.

## Next up (in priority order)
- Not a decision.
`;

test("reads only the Waiting on Douglas bullets", () => {
  const items = parseDecisions(MD);
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((x) => x.kind), ["decision", "decision", "task", "decision", "task"]);
  assert.equal(items[0].title, "Score EV/EBITDA against sector peers?");
  assert.equal(items[0].date, "10 Nov");
  assert.equal(items[0].gist, "Like P/E since 10 Nov.");
  assert.equal(items[1].title, "OK to keep the five pick names in the public repo?");
  assert.equal(items[1].gist, "Alternative: load the plan from the browser.");
  assert.equal(items[1].date, null);
  assert.equal(items[2].title, "Optional FINNHUB_KEY secret");
  assert.equal(items[3].title, "REITs on cash flow, not P/E");
  assert.match(items[3].gist, /^A display-only REIT view/);
  assert.match(items[3].body, /continued on a second line/);
  assert.equal(items[4].title, "Your own research list");
});

test("no section, no items", () => {
  assert.deepEqual(parseDecisions("# Roadmap\n\n## Next up\n- x"), []);
  assert.deepEqual(parseDecisions(null), []);
});

test("summary line", () => {
  assert.equal(decisionsLine([]), "Nothing waiting on you");
  assert.equal(decisionsLine(parseDecisions(MD)), "3 decisions and 2 tasks waiting on you");
  assert.equal(decisionsLine([{ kind: "decision" }]), "1 decision waiting on you");
});

test("text helpers", () => {
  assert.equal(plain("**a** *b* `c` [d](http://x)"), "a b c d");
  const long = "word ".repeat(60) + "end.";
  assert.ok(firstSentence(long, 50).length <= 51);
  assert.ok(firstSentence(long, 50).endsWith("…"));
  const esc = (s) => s.replace(/</g, "&lt;");
  assert.equal(inlineHtml("**a** <x> `c`", esc), "<b>a</b> &lt;x> <code>c</code>");
});

test("the live roadmap parses", () => {
  const items = parseDecisions(readFileSync(new URL("../docs/ROADMAP.md", import.meta.url), "utf8"));
  for (const x of items) { assert.ok(x.title.length > 3); assert.ok(!/\*\*/.test(x.title)); }
});
