// Syntax check of every page's inline scripts: a typo there blanks the whole
// page in the browser while every unit test still passes (11 Nov).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const page of ["index.html", "research.html", "trends.html", "reviews.html"]) {
  test(`${page}: inline scripts parse`, () => {
    let html;
    try { html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8"); } catch { return; }
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
    const dir = mkdtempSync(join(tmpdir(), "pages-"));
    scripts.forEach(([, attrs, code], i) => {
      const f = join(dir, `${page}.${i}.${/type="module"/.test(attrs) ? "mjs" : "cjs"}`);
      writeFileSync(f, code);
      try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
      catch (e) { assert.fail(`${page} script ${i}: ${String(e.stderr).split("\n").slice(0, 5).join(" ")}`); }
    });
  });
}
