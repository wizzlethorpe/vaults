// Obsidian-compat regression tests.
//
// Each fix in this file plugs a divergence between how Obsidian and the
// vaults CLI render the same source. End-to-end via buildSite() so the
// assertion runs through the same plugin pipeline a real deploy uses.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";
import { renderBase } from "../src/render/bases.js";
import { mkContext } from "./bases-helpers.js";

interface Vault { dir: string; out: string; }

async function setupVault(files: Record<string, string>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-compat-"));
  const out = join(dir, "_out");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return { dir, out };
}

async function cleanup(v: Vault): Promise<void> {
  await rm(v.dir, { recursive: true, force: true });
}

async function build(v: Vault): Promise<void> {
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await buildSite({
      vaultPath: v.dir,
      outputDir: v.out,
      vaultName: "Test",
      imageQuality: 0,
      maxFileBytes: 1 << 30,
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

const VAULTRC_1 = JSON.stringify({ roles: ["public"], rolePasswords: {} });

// ── Block references in embeds ────────────────────────────────────────────

describe("embed: ![[Page#^block-id]] block references", () => {
  it("trailing-marker form: `text ^id` on the last line of a paragraph", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Notes.md":
        "Some other paragraph.\n\n" +
        "This is the quote we care about. ^pull-me\n\n" +
        "Another paragraph.\n",
      // Embed on its own line so the page-transclusion path runs.
      "Page.md": "Lead-in.\n\n![[Notes#^pull-me]]\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      // Scope assertions to the embed body; the outgoing source-link
      // appended to every transclusion shows the original anchor text
      // (↗ Notes › ^pull-me), which is fine and unrelated to the fix.
      const embed = /<div class="embed">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
      assert.match(embed, /This is the quote we care about\./);
      // The marker itself is stripped from the transcluded content.
      assert.doesNotMatch(/<p>[^<]*\^pull-me[^<]*<\/p>/.exec(embed)?.[0] ?? "no-match",
        /\^pull-me/);
      assert.doesNotMatch(embed, /Some other paragraph/);
      assert.doesNotMatch(embed, /Another paragraph/);
    } finally { await cleanup(v); }
  });

  it("alone-on-line form: marker on its own line right after the block", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Notes.md":
        "Other.\n\n" +
        "Here is a list item that is the block.\n" +
        "^block-2\n\n" +
        "Tail.\n",
      "Page.md": "![[Notes#^block-2]]\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      const embed = /<div class="embed">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
      assert.match(embed, /Here is a list item that is the block\./);
      assert.doesNotMatch(embed, /Tail\./);
    } finally { await cleanup(v); }
  });
});

// ── Multi-anchor wikilinks ────────────────────────────────────────────────

describe("wikilink: chained heading anchors [[Page#H1#H2]]", () => {
  it("resolves the URL fragment to the deepest heading", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Lore.md":
        "# Setting\n\n" +
        "## History\n\n" +
        "Some history text.\n\n" +
        "### Wars\n\n" +
        "Wars text.\n",
      "Page.md": "See [[Lore#History#Wars]] for details.\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      // The URL fragment is the deepest segment, not "History" or an
      // unparseable "History#Wars". Case-insensitive: rehype-slug
      // lowercases ids but the wikilink emitter doesn't, and the browser
      // navigates fine either way.
      assert.match(html, /href="\/?Lore#Wars"/i);
    } finally { await cleanup(v); }
  });
});

// ── Callout fold markers + hyphenated types ───────────────────────────────

describe("callouts: fold markers and hyphenated types", () => {
  it("[!note]+ becomes <details open>", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "> [!note]+ Foldable open\n> Body text here.\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<details[^>]*class="callout callout-note"[^>]*open[^>]*>/);
      assert.match(html, /<summary class="callout-title">Foldable open<\/summary>/);
      assert.match(html, /Body text here\./);
    } finally { await cleanup(v); }
  });

  it("[!note]- becomes <details> (collapsed by default; no open attr)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "> [!note]- Foldable closed\n> Body text here.\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<details[^>]*class="callout callout-note"[^>]*>/);
      // The wrapper element opens but does not carry an `open` attribute.
      const detailsTag = /<details[^>]*>/.exec(html)?.[0] ?? "";
      assert.doesNotMatch(detailsTag, /\bopen\b/);
    } finally { await cleanup(v); }
  });

  it("hyphenated type [!my-note] is recognised", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "> [!my-note] Custom\n> Body text.\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /class="callout callout-my-note"/);
      assert.match(html, /data-callout="my-note"/);
    } finally { await cleanup(v); }
  });
});

// ── Image extensions ──────────────────────────────────────────────────────

describe("image extensions: bmp / heic / apng treated as images", () => {
  it("![[picture.bmp]] renders as <img>, not as a page transclusion", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "Look: ![[picture.bmp]]\n",
      // The build only ships images it has on disk; supply a stub so the
      // path resolves through the image index. Content doesn't matter for
      // this test (imageQuality: 0 disables compression).
      "picture.bmp": "stub",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<img[^>]*src="\/picture\.bmp"/);
    } finally { await cleanup(v); }
  });
});

// ── Bases: today() and file.hasLink() ─────────────────────────────────────

describe("bases: today() returns midnight UTC", () => {
  it("compares equal to a YYYY-MM-DD frontmatter date for today's date", () => {
    // gray-matter / js-yaml parses YYYY-MM-DD as a Date at midnight UTC;
    // we mirror that here by handing mkContext a Date directly (which is
    // what bases.ts will see in production). now() carries wall-clock
    // time and won't compare equal; today() must drop time to match.
    const d = new Date();
    const today = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const long_ago = new Date(Date.UTC(1999, 0, 1));
    const ctx = mkContext([
      { path: "Today.md", fm: { event_date: today } },
      { path: "Other.md", fm: { event_date: long_ago } },
    ]);
    const html = renderBase(`filters: 'event_date == today()'`, ctx);
    assert.match(html, /Today/);
    assert.doesNotMatch(html, />Other</);
  });
});

describe("bases: file.hasLink() actually checks outlinks", () => {
  it("filters rows by whether their page links to the named target", async () => {
    // End-to-end so the build's outlink pre-scan runs (Bases needs
    // outlinksByPath populated on the RenderContext).
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Aldric.md": "# Aldric\n\nSee [[Brunhilde]] for details.\n",
      "Brunhilde.md": "# Brunhilde\n\nNo outgoing links.\n",
      "Index.md":
        "# Index\n\n" +
        "```base\n" +
        "filters: 'file.hasLink(\"Brunhilde\")'\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Index.html"), "utf8");
      // Scope the assertion to the bases table; the sidebar navigation
      // mentions every page regardless of filter and would otherwise mask
      // a regression.
      const tableMatch = /<table class="bases-table">[\s\S]*?<\/table>/.exec(html);
      assert.ok(tableMatch, "expected a bases-table in the rendered Index page");
      const table = tableMatch[0];
      assert.match(table, />Aldric</);
      assert.doesNotMatch(table, />Brunhilde</);
    } finally { await cleanup(v); }
  });
});
