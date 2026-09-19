// Tests for the custom-handler system (render/handlers/).
//
// Coverage:
//   1. Built-in `fm:` handlers insert frontmatter values.
//   2. User-defined handlers in .vaults/handlers/ are picked up and run.
//   3. User code-block handlers can emit markdown that flows through the
//      rest of the pipeline (wikilinks resolve in handler-emitted markdown).
//   4. Multiple handlers per file (named export `handlers: []`) are loaded.
//   5. Handler files that don't export anything usable warn but don't crash.
//   6. User handler can override a built-in (last-registered wins).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";
import { loadUserHandlers } from "../src/render/handlers/loader.js";
import { buildRegistry } from "../src/render/handlers/types.js";
import { VAULTRC_1, build, cleanup, setupVault } from "./vault-helpers.js";

describe("built-in fm handler", () => {
  it("inserts a string frontmatter value as markdown", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nclass: Wizard\n---\nThe `fm: class` casts.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /The <span class="fm-value">Wizard<\/span> casts\./);
    } finally { await cleanup(v); }
  });

  it("coerces numbers and joins arrays", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nlevel: 7\ntags: [arcane, fire]\n---\nLevel `fm: level`, tags `fm: tags`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /Level <span class="fm-value">7<\/span>, tags <span class="fm-value">arcane, fire<\/span>\./);
    } finally { await cleanup(v); }
  });

  it("formats YAML-parsed Date values as YYYY-MM-DD", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nbirthday: 1239-09-28\n---\nBorn `fm: birthday`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /Born <span class="fm-value">1239-09-28<\/span>\./);
    } finally { await cleanup(v); }
  });

  it("walks dot-paths into nested objects", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md":
        "---\n" +
        "stats:\n" +
        "  hp: 22\n" +
        "  abilities:\n" +
        "    str: 14\n" +
        "---\n" +
        "HP `fm: stats.hp`, STR `fm: stats.abilities.str`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /HP <span class="fm-value">22<\/span>, STR <span class="fm-value">14<\/span>\./);
    } finally { await cleanup(v); }
  });

  it("missing dot-path segments emit the warning marker", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nstats:\n  hp: 22\n---\nMissing: `fm: stats.nope.deep`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<code class="fm-missing"[^>]*>\{\{stats\.nope\.deep\}\}<\/code>/);
    } finally { await cleanup(v); }
  });
});

// ── Built-in fm code-block handler ────────────────────────────────────────
//
// The code-block form (`` ```fm ``) renders a frontmatter value inside a
// <pre><code>, with the fence's meta string used as the language hint. Used
// when the value IS code (or otherwise wants a <pre> wrapper) and you don't
// want to duplicate it between the frontmatter and the body. Verifies the
// dispatcher correctly threads node.meta through to the handler context, a
// surface that didn't exist before this handler shipped.

describe("built-in fm code-block handler", () => {
  it("renders the frontmatter value inside <pre><code> with the language class from the fence meta", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": [
        "---",
        "snippet: 'const x = 1;'",
        "---",
        "",
        "```fm javascript",
        "snippet",
        "```",
      ].join("\n"),
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<pre><code class="language-javascript">const x = 1;<\/code><\/pre>/);
    } finally { await cleanup(v); }
  });

  it("omits the language class when no fence meta is given", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": [
        "---",
        "note: 'plain text'",
        "---",
        "",
        "```fm",
        "note",
        "```",
      ].join("\n"),
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<pre><code>plain text<\/code><\/pre>/);
      assert.doesNotMatch(html, /class="language-/);
    } finally { await cleanup(v); }
  });

  it("a missing path or non-string value renders the fm-missing marker (inside <pre>)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": [
        "---",
        "real: value",
        "---",
        "",
        "```fm",
        "fake.path",
        "```",
      ].join("\n"),
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<pre><code class="fm-missing"[^>]*>\{\{fake\.path: not a string\}\}<\/code><\/pre>/);
    } finally { await cleanup(v); }
  });

  it("HTML-escapes the value so script-tag-shaped strings don't escape the <pre>", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": [
        "---",
        "snippet: '<script>alert(1)</script>'",
        "---",
        "",
        "```fm html",
        "snippet",
        "```",
      ].join("\n"),
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    } finally { await cleanup(v); }
  });
});

describe("user handler loading", () => {
  it("discovers handlers from .vaults/handlers/*.mjs", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/shout.mjs":
        "export const handler = { inline: 'shout', render: (s) => ({ html: '<strong>' + s.toUpperCase() + '</strong>' }) };\n",
      "Page.md": "Hey: `shout: hello`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<strong>HELLO<\/strong>/);
    } finally { await cleanup(v); }
  });

  it("supports the `handlers: []` array export with multiple handlers per file", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/multi.mjs":
        "export const handlers = [\n" +
        "  { inline: 'lo', render: (s) => ({ html: '<em>' + s.toLowerCase() + '</em>' }) },\n" +
        "  { codeBlock: 'reverse', render: (s) => ({ html: '<pre>' + s.split('').reverse().join('') + '</pre>' }) },\n" +
        "];\n",
      "Page.md": "Inline: `lo: HELLO`.\n\n```reverse\nabcdef\n```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<em>hello<\/em>/);
      assert.match(html, /<pre>fedcba<\/pre>/);
    } finally { await cleanup(v); }
  });

  it("user handlers can override built-in handlers (last-registered wins)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/fm-override.mjs":
        "export const handler = { inline: 'fm', render: (s) => ({ html: '<span class=\"override\">' + s + '</span>' }) };\n",
      "Page.md": "---\nlevel: 7\n---\n`fm: level`",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<span class="override">level<\/span>/);
      assert.doesNotMatch(html, /class="fm-value"/);
    } finally { await cleanup(v); }
  });

  it("ignores files that don't export `handler` or `handlers` (with a warning)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/empty.mjs": "export const something = 'else';\n",
      "Page.md": "`shout: x`",
    });
    try {
      // Should not throw; the unrelated module is skipped.
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      // No matching handler, so the inline-code falls through unchanged.
      assert.match(html, /<code>shout: x<\/code>/);
    } finally { await cleanup(v); }
  });
});

// ── Code-block handlers, markdown output, and pipeline composition ───────

describe("code-block handlers", () => {
  it("user code-block handler emitting markdown is processed by the rest of the pipeline", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/seealso.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'seealso',\n" +
        "  render: (content) => ({ markdown: content.split(/\\r?\\n/).filter(Boolean).map(p => '- [[' + p.trim() + ']]').join('\\n') }),\n" +
        "};\n",
      "Page.md":
        "## See also\n\n```seealso\nOther\nThird\n```\n",
      "Other.md": "# Other Page",
      "Third.md": "# Third Page",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      // The handler emitted markdown wikilinks; the wikilink plugin
      // resolved them to actual <a class="internal …"> links pointing at
      // the other pages. If pipeline ordering were wrong, we'd see raw
      // [[Other]] text instead.
      assert.match(html, /<a href="\/?Other" class="internal[^"]*">Other<\/a>/);
      assert.match(html, /<a href="\/?Third" class="internal[^"]*">Third<\/a>/);
    } finally { await cleanup(v); }
  });
});

// ── Loader unit tests ────────────────────────────────────────────────────

describe("loadUserHandlers", () => {

  it("filters out files with non-handler exports and tracks source paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-filter-"));
    const hdir = join(dir, ".vaults/handlers");
    await mkdir(hdir, { recursive: true });
    await writeFile(join(hdir, "ok.mjs"),
      "export const handler = { inline: 'hi', render: () => ({ html: 'x' }) };\n");
    await writeFile(join(hdir, "bad.mjs"), "export const garbage = { not: 'a handler' };\n");
    await writeFile(join(hdir, "ignored.txt"), "not a JS file at all");
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const handlers = await loadUserHandlers(dir);
      assert.equal(handlers.length, 1);
      assert.equal((handlers[0]!.handler as { inline?: string }).inline, "hi");
      assert.equal(handlers[0]!.sourcePath, join(hdir, "ok.mjs"));
    } finally {
      console.warn = origWarn;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── Recursion ────────────────────────────────────────────────────────────

describe("handler recursion", () => {
  it("handler-emitted markdown containing an inline handler is dispatched again", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/wrap.mjs":
        // Without recursion the emitted `fm:` would ship as plain inline code.
        "export const handler = {\n" +
        "  codeBlock: 'wrap',\n" +
        "  render: (content) => ({ markdown: content + ' (`fm: level`)' }),\n" +
        "};\n",
      "Page.md": "---\nlevel: 7\n---\n```wrap\nattack roll\n```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /attack roll \(<span class="fm-value">7<\/span>\)/);
    } finally { await cleanup(v); }
  });

  it("self-recursive handler bottoms out at the depth limit without crashing", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/loop.mjs":
        // Inline handler that always re-emits its own trigger. Without a
        // depth limit this would loop forever.
        "export const handler = {\n" +
        "  inline: 'loop',\n" +
        "  render: () => ({ markdown: '`loop: x`' }),\n" +
        "};\n",
      "Page.md": "Trigger: `loop: x`",
    });
    try {
      // Don't use the build() helper here: it stubs console.warn to
      // silence build chatter, which would also swallow the depth-limit
      // warning we want to assert on.
      const origLog = console.log;
      const origWarn = console.warn;
      const warnings: string[] = [];
      console.log = () => {};
      console.warn = (msg: unknown) => warnings.push(String(msg));
      try {
        await buildSite({
          vaultPath: v.dir,
          outputDir: v.out,
        });
      } finally {
        console.log = origLog;
        console.warn = origWarn;
      }
      // Build completes (no stack overflow / hang).
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.ok(html.length > 0);
      // The depth-limit warning fired at least once.
      assert.ok(
        warnings.some((w) => /recursion depth/.test(w)),
        `expected a recursion-depth warning; got: ${warnings.join(" | ")}`,
      );
    } finally { await cleanup(v); }
  });
});

// ── Asset bundling ───────────────────────────────────────────────────────

describe("handler asset bundling", () => {
  it("a built-in's runtime ships in /_handlers.js, and the layout links both bundles", async () => {
    const v = await setupVault({ ".vaultrc.json": VAULTRC_1, "Page.md": "# Page\n" });
    try {
      await build(v);
      assert.match(await readFile(join(v.out, "_handlers.js"), "utf8"), /builtin\/gallery\.runtime\.js/);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<script src="\/_handlers\.js\?v=[a-f0-9]+" defer><\/script>/);
      assert.match(html, /<link[^>]*_handlers\.css/);
    } finally { await cleanup(v); }
  });

  it("multi-role middleware allowlists /_handlers.js and /_handlers.css so they don't 404", async () => {
    const v = await setupVault({
      ".vaultrc.json": JSON.stringify({
        roles: ["public", "dm"],
        rolePasswords: { dm: "100000:0000:0000" },
      }),
      ".vaults/handlers/widget.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'widget',\n" +
        "  assets: { scripts: ['./widget.runtime.js'], styles: ['./widget.css'] },\n" +
        "  render: () => ({ html: '<div class=\"widget\"></div>' }),\n" +
        "};\n",
      ".vaults/handlers/widget.runtime.js": "(function(){})();\n",
      ".vaults/handlers/widget.css": ".widget {}\n",
      "Page.md": "```widget\n```\n",
    });
    try {
      await build(v);
      const mw = await readFile(join(v.out, "functions/_middleware.js"), "utf8");
      assert.match(mw, /pathname === "\/_handlers\.js"/);
      assert.match(mw, /pathname === "\/_handlers\.css"/);
    } finally { await cleanup(v); }
  });

  it("user-handler runtime is concatenated into the same bundle", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/widget.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'widget',\n" +
        "  assets: { scripts: ['./widget.runtime.js'], styles: ['./widget.css'] },\n" +
        "  render: () => ({ html: '<div class=\"widget\"></div>' }),\n" +
        "};\n",
      ".vaults/handlers/widget.runtime.js":
        "(function () { window.__widgetMarker = 'WIDGET-RUNTIME'; })();\n",
      ".vaults/handlers/widget.css":
        ".widget { color: rebeccapurple; }\n",
      "Page.md": "```widget\n```\n",
    });
    try {
      await build(v);
      const js = await readFile(join(v.out, "_handlers.js"), "utf8");
      const css = await readFile(join(v.out, "_handlers.css"), "utf8");
      assert.match(js, /WIDGET-RUNTIME/);
      assert.match(css, /rebeccapurple/);
    } finally { await cleanup(v); }
  });

  it("dedups identical asset paths across multiple handlers", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/shared.js":
        "// SHARED-LIB\nwindow.__shared = true;\n",
      ".vaults/handlers/a.mjs":
        "export const handler = {\n" +
        "  inline: 'a',\n" +
        "  assets: { scripts: ['./shared.js'] },\n" +
        "  render: (s) => ({ html: '<span class=\"a\">' + s + '</span>' }),\n" +
        "};\n",
      ".vaults/handlers/b.mjs":
        "export const handler = {\n" +
        "  inline: 'b',\n" +
        "  assets: { scripts: ['./shared.js'] },\n" +
        "  render: (s) => ({ html: '<span class=\"b\">' + s + '</span>' }),\n" +
        "};\n",
      "Page.md": "`a: x` and `b: y`",
    });
    try {
      await build(v);
      const js = await readFile(join(v.out, "_handlers.js"), "utf8");
      // Body of shared.js appears exactly once.
      const matches = js.match(/SHARED-LIB/g) ?? [];
      assert.equal(matches.length, 1, `expected shared lib once, got ${matches.length}`);
    } finally { await cleanup(v); }
  });

  it("refuses asset paths that escape .vaults/handlers/ (build fails loudly)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "secret.txt": "TOP-SECRET-SHOULD-NOT-LEAK",
      ".vaults/handlers/evil.mjs":
        "export const handler = {\n" +
        "  inline: 'evil',\n" +
        "  assets: { scripts: ['../../secret.txt'] },\n" +
        "  render: () => ({ html: '' }),\n" +
        "};\n",
      "Page.md": "Hello.",
    });
    try {
      await assert.rejects(
        () => build(v),
        /handler asset path escapes/,
      );
    } finally { await cleanup(v); }
  });
});

// ── Registry and helpers ─────────────────────────────────────────────────

describe("buildRegistry", () => {

  it("buildRegistry warns when a user handler shadows a built-in", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(msg); };
    try {
      buildRegistry(
        [
          { inline: "fm", render: () => ({ html: "builtin" }) },
          { codeBlock: "gallery", render: () => ({ html: "builtin" }) },
        ],
        [
          { inline: "fm", render: () => ({ html: "user" }) },
          { codeBlock: "gallery", render: () => ({ html: "user" }) },
        ],
      );
    } finally { console.warn = origWarn; }
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /shadows the built-in/);
    assert.match(warnings[0]!, /fm/);
    assert.match(warnings[1]!, /gallery/);
  });

  it("buildRegistry stays silent when user handlers don't collide with built-ins", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(msg); };
    try {
      buildRegistry(
        [{ inline: "fm", render: () => ({ html: "builtin" }) }],
        [{ inline: "shout", render: () => ({ html: "user" }) }],
      );
    } finally { console.warn = origWarn; }
    assert.equal(warnings.length, 0);
  });
});
