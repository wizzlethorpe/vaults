// Tests for the renderer's handling of `![[file]]` embeds and `[[wikilinks]]`.
//
// Coverage by form (the rendering decision is extension-driven, and a regression
// in any single branch is silent because each branch falls through differently
// on miss):
//
//   ![[image.webp]]              → <img src=... loading=lazy>
//   ![[image.webp|N]]            → <img ... width="N">
//   ![[clip.ogg]]                → <audio controls preload=metadata>
//   ![[clip.mp4]]                → <video controls preload=metadata>
//   ![[doc.pdf]]                 → <a class="passthrough-link" href=...>
//   ![[Page]]                    → transcluded content
//   ![[Missing]]                 → broken-embed card
//   [[Other Page]]               → <a class="internal internal-link" href=...>
//   [[Missing Page]]             → broken styled link
//   [[Other Page|alias]]         → link text uses alias
//   [[Other Page#section]]       → href includes #section
//
// Plus a regression-lock test that all three embed flavours render correctly
// when used together on the same page (this is the case b164f47 broke when
// the audio/video work mis-defined MEDIA_EMBED_EXT_RE).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; out: string; }

async function setupVault(files: Record<string, string | Buffer>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-embed-"));
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
  // Suppress build chatter; assertions read the rendered HTML directly.
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await buildSite({
      vaultPath: v.dir,
      outputDir: v.out,
      vaultName: "Test",
      // 0 disables image compression (sharp warm-up cost), but the image
      // still gets staged + copied into the variant output. The dummy webp
      // bytes below never go through sharp.
      imageQuality: 0,
      maxFileBytes: 1 << 30,
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

async function readBody(v: Vault, path: string): Promise<string> {
  // Single-role builds collapse _variants/public/... to the deploy root
  // (no Pages Functions, no auth). All tests in this file use the
  // single-role VAULTRC_1, so files land under v.out directly.
  return readFile(join(v.out, path), "utf8");
}

const VAULTRC_1 = JSON.stringify({ roles: ["public"], rolePasswords: {} });

// Tiny placeholder bytes — the renderer never inspects content, only references.
// Real format isn't required for these tests; the build copies passthroughs and
// non-compressed images byte-for-byte under imageQuality: 0.
const PLACEHOLDER = Buffer.from("placeholder");

// ── Embed tests ───────────────────────────────────────────────────────────

describe("![[file]] embeds: images", () => {
  it("renders ![[image.webp]] as <img> with the served URL", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "portrait.webp": PLACEHOLDER,
      "Page.md": "# Page\n\n![[portrait.webp]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<img[^>]+src="\/portrait\.webp"/, "src points at the deployed file");
      assert.match(html, /alt="portrait\.webp"/, "alt defaults to the filename");
      assert.match(html, /loading="lazy"/, "img is lazy-loaded");
    } finally { await cleanup(v); }
  });

  it("honours an explicit |N width hint", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "portrait.webp": PLACEHOLDER,
      "Page.md": "# Page\n\n![[portrait.webp|240]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<img[^>]+width="240"/, "width attribute reflects the |N hint");
    } finally { await cleanup(v); }
  });

  // Standard markdown image syntax: a relative URL the author wrote
  // (e.g. ../attachments/foo.webp from a subdir) must be normalised to
  // the absolute deployed URL. Otherwise the wiki render works only by
  // accident of the browser resolving the relative path against the
  // current page URL — anywhere else loading the rendered HTML out of
  // context (the Foundry journal sheet runs from /game) ends up pointing
  // at the wrong place and 404s.
  it("rewrites a relative ![alt](path) markdown image to an absolute URL", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "attachments/portrait.webp": PLACEHOLDER,
      "Notes/Page.md": "# Page\n\n![A portrait](../attachments/portrait.webp)\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Notes/Page.body.html");
      assert.match(html, /<img[^>]+src="\/attachments\/portrait\.webp"/,
        "relative author URL must be rewritten to the absolute slugified path");
      assert.doesNotMatch(html, /\.\.\//,
        "relative path segments must not survive into the rendered HTML");
    } finally { await cleanup(v); }
  });

  it("leaves external image URLs alone", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "# Page\n\n![logo](https://example.com/logo.png)\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<img[^>]+src="https:\/\/example\.com\/logo\.png"/);
    } finally { await cleanup(v); }
  });
});

describe("![[file]] embeds: audio", () => {
  it("renders ![[clip.ogg]] as <audio controls>", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "clip.ogg": PLACEHOLDER,
      "Page.md": "# Page\n\n![[clip.ogg]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<audio[^>]+controls/, "audio element has controls");
      assert.match(html, /<audio[^>]+src="\/clip\.ogg"/, "src points at the deployed file");
      assert.match(html, /<audio[^>]+preload="metadata"/, "preload is set to metadata");
      assert.doesNotMatch(html, /page not found/, "audio doesn't fall through to the page-transclusion path");
    } finally { await cleanup(v); }
  });

  it("renders other audio extensions (mp3) the same way", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "clip.mp3": PLACEHOLDER,
      "Page.md": "# Page\n\n![[clip.mp3]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<audio[^>]+src="\/clip\.mp3"/);
    } finally { await cleanup(v); }
  });
});

describe("![[file]] embeds: video", () => {
  it("renders ![[clip.mp4]] as <video controls>", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "clip.mp4": PLACEHOLDER,
      "Page.md": "# Page\n\n![[clip.mp4]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<video[^>]+controls/);
      assert.match(html, /<video[^>]+src="\/clip\.mp4"/);
      assert.match(html, /<video[^>]+preload="metadata"/);
    } finally { await cleanup(v); }
  });
});

describe("![[file]] embeds: other passthroughs", () => {
  it("renders ![[doc.pdf]] as a plain link", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "doc.pdf": PLACEHOLDER,
      "Page.md": "# Page\n\n![[doc.pdf]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<a[^>]+class="passthrough-link"[^>]+href="\/doc\.pdf"/);
      assert.match(html, />doc\.pdf</, "link text is the filename");
      assert.doesNotMatch(html, /<embed|<object|page not found/, "no auto-embed for non-media passthroughs");
    } finally { await cleanup(v); }
  });

  it("renders ![[data.json]] as a plain link", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "data.json": "{}",
      "Page.md": "# Page\n\n![[data.json]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<a[^>]+class="passthrough-link"[^>]+href="\/data\.json"/);
    } finally { await cleanup(v); }
  });
});

describe("![[Page]] page transclusion", () => {
  it("inlines the target page's content", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Other.md": "# Other\n\nTransclude me.\n",
      "Host.md": "# Host\n\n![[Other]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Host.body.html");
      assert.match(html, /Transclude me/, "target body content was inlined");
      assert.match(html, /class="embed/, "transclusion is wrapped in an embed container");
    } finally { await cleanup(v); }
  });

  it("renders a broken-embed card when the page doesn't exist", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Host.md": "# Host\n\n![[Missing]]\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Host.body.html");
      assert.match(html, /class="embed embed-broken"/);
      assert.match(html, /page not found/i);
    } finally { await cleanup(v); }
  });
});

// ── External-link tagging ──────────────────────────────────────────────────
//
// `[label](https://…)` should open in a new tab so a click doesn't drop the
// reader off the wiki. Implemented via mdast plugin so the attributes are
// baked into the HTML — Foundry-side journal renderings inherit the
// behaviour too. Internal wikilinks and relative URLs stay in-tab.

describe("external link tagging", () => {
  it("opens https://… links in a new tab with noopener", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "# Page\n\nSee [the docs](https://example.com/docs).\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<a[^>]+href="https:\/\/example\.com\/docs"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);
    } finally { await cleanup(v); }
  });

  it("leaves relative links in the same tab", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "# Page\n\n[Local file](handouts/letter.pdf).\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      // The link should NOT have target= attribute
      const m = /<a[^>]+href="handouts\/letter\.pdf"[^>]*>/.exec(html);
      assert.ok(m, "anchor must render");
      assert.doesNotMatch(m[0], /target=/, "relative links stay in-tab");
    } finally { await cleanup(v); }
  });

  it("leaves internal wikilinks in the same tab", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Other.md": "# Other",
      "Page.md": "# Page\n\nSee [[Other]].\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      const m = /<a[^>]+class="[^"]*\binternal-link\b[^"]*"[^>]*>/.exec(html);
      assert.ok(m, "internal link must render");
      assert.doesNotMatch(m[0], /target=/, "internal wikilinks stay in-tab");
    } finally { await cleanup(v); }
  });
});

// ── Wikilink tests ────────────────────────────────────────────────────────

describe("[[wikilinks]]", () => {
  it("renders [[Other Page]] as an internal link", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Other Page.md": "# Other Page",
      "Host.md": "# Host\n\nSee [[Other Page]] for context.\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Host.body.html");
      // class can be "internal internal-link" or some superset; match the
      // load-bearing token rather than the full attribute.
      assert.match(html, /<a[^>]+class="[^"]*\binternal-link\b/);
      assert.match(html, /href="\/Other%20Page"/);
      assert.match(html, />Other Page</);
    } finally { await cleanup(v); }
  });

  it("renders a missing wikilink as styled broken text", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Host.md": "# Host\n\nSee [[Nowhere]] for context.\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Host.body.html");
      // Broken wikilinks render as <a> with the is-unresolved class so the
      // CSS can dim them. Either way, the label is preserved.
      assert.match(html, /is-unresolved/);
      assert.match(html, />Nowhere</);
    } finally { await cleanup(v); }
  });

  it("uses the alias as link text when present ([[Page|alias]])", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Other Page.md": "# Other Page",
      "Host.md": "# Host\n\nSee [[Other Page|the other one]].\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Host.body.html");
      assert.match(html, />the other one</, "link text uses the alias");
      assert.match(html, /href="\/Other%20Page"/, "href still points at the target");
    } finally { await cleanup(v); }
  });

  it("includes the section anchor in the href ([[Page#section]])", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Other Page.md": "# Other Page\n\n## A section\n\nstuff",
      "Host.md": "# Host\n\nSee [[Other Page#A section]].\n",
    });
    try {
      await build(v);
      const html = await readBody(v, "Host.body.html");
      // Anchor segment normalised to the rehype-slug shape; allow either
      // raw "A section" or slugified "a-section" in the href.
      assert.match(html, /href="\/Other%20Page#(?:A%20section|a-section)"/);
    } finally { await cleanup(v); }
  });
});

// ── Regression lock ────────────────────────────────────────────────────────

describe("regression: image + audio + passthrough on the same page", () => {
  // Locks in b164f47. The audio/video work briefly defined MEDIA_EMBED_EXT_RE
  // = PASSTHROUGH_EXT_RE (which excludes image extensions), so image embeds
  // fell through to the page-transclusion path and rendered as broken
  // "page not found" cards. This test would have caught it.
  it("all three media branches render correctly when used together", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "portrait.webp": PLACEHOLDER,
      "clip.ogg": PLACEHOLDER,
      "doc.pdf": PLACEHOLDER,
      "Page.md": [
        "# Page",
        "",
        "![[portrait.webp]]",
        "",
        "![[clip.ogg]]",
        "",
        "![[doc.pdf]]",
        "",
      ].join("\n"),
    });
    try {
      await build(v);
      const html = await readBody(v, "Page.body.html");
      assert.match(html, /<img[^>]+src="\/portrait\.webp"/, "image renders as <img>");
      assert.match(html, /<audio[^>]+src="\/clip\.ogg"/, "audio renders as <audio>");
      assert.match(html, /<a[^>]+class="passthrough-link"[^>]+href="\/doc\.pdf"/, "pdf renders as <a>");
      assert.doesNotMatch(html, /page not found/i, "no embed branch fell through to page transclusion");
      assert.doesNotMatch(html, /class="embed embed-broken"/, "no broken-embed cards");
    } finally { await cleanup(v); }
  });
});
