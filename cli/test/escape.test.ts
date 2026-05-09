// Sanity checks for the canonical HTML-escape helpers + a guard that the
// auth-template's inline copies (which can't import them) stay byte-for-byte
// in sync with the canonical implementations.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { htmlEscape, htmlAttr } from "../src/escape.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

describe("htmlEscape", () => {
  it("escapes the five HTML-special characters", () => {
    assert.equal(htmlEscape(`a & b < c > d " e ' f`), "a &amp; b &lt; c &gt; d &quot; e &#39; f");
  });
  it("is a no-op on safe text", () => {
    assert.equal(htmlEscape("hello world 123"), "hello world 123");
  });
});

describe("htmlAttr", () => {
  it("escapes the four attribute-context characters", () => {
    assert.equal(htmlAttr(`a & b < c > d " e ' f`), `a &amp; b &lt; c &gt; d &quot; e ' f`);
  });
});

describe("auth-template escape helpers stay in sync", () => {
  // The Cloudflare Pages Function emitted by auth-template.ts can't `import`
  // from cli/src/escape.ts at runtime, so it ships its own inline copies.
  // If you change either side without updating the other, this guard fires.
  it("inline escHtml + escAttr lines match the documented strings", async () => {
    const src = await readFile(resolve(repoRoot, "src/render/auth-template.ts"), "utf8");
    const escHtml = `function escHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }`;
    const escAttr = `function escAttr(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }`;
    assert.ok(src.includes(escHtml), "auth-template.ts escHtml drifted from canonical shape");
    assert.ok(src.includes(escAttr), "auth-template.ts escAttr drifted from canonical shape");
  });
});
