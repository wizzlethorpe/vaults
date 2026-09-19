// Tests for layout-shape concerns rendered by buildSite():
//   - The footer setting is rendered into every page.
//   - Empty footer setting suppresses the <footer> entirely.
//   - Footer markdown links resolve to <a href> tags.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; out: string; }

async function setup(files: Record<string, string>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-layout-"));
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
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

const VAULTRC_1 = JSON.stringify({ roles: ["public"], rolePasswords: {} });

describe("layout: footer setting", () => {
  it("default footer renders as a <footer> with the Wizzlethorpe credit link", async () => {
    const v = await setup({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "Hello.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<footer class="site-footer">/);
      assert.match(html, /<a href="https:\/\/vaults\.wizzlethorpe\.com">Wizzlethorpe Vaults<\/a>/);
    } finally { await cleanup(v); }
  });

  it("custom footer markdown is rendered (links + emphasis)", async () => {
    const v = await setup({
      ".vaultrc.json": VAULTRC_1,
      "settings.md": "---\nfooter: '© 2026 [Acme Co](https://example.com). *All rights reserved.*'\n---\n",
      "Page.md": "Hello.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<footer class="site-footer">/);
      assert.match(html, /<a href="https:\/\/example\.com">Acme Co<\/a>/);
      assert.match(html, /<em>All rights reserved\.<\/em>/);
    } finally { await cleanup(v); }
  });

  it("empty footer setting suppresses the <footer> entirely", async () => {
    const v = await setup({
      ".vaultrc.json": VAULTRC_1,
      "settings.md": "---\nfooter: ''\n---\n",
      "Page.md": "Hello.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.doesNotMatch(html, /<footer class="site-footer">/);
    } finally { await cleanup(v); }
  });
});

describe("layout: page head and lightbox", () => {
  it("loads handler styles before user.css, so a snippet can restyle a handler", async () => {
    const v = await setup({ ".vaultrc.json": VAULTRC_1, "index.md": "# Home\n" });
    try {
      await build(v);
      const html = await readFile(join(v.out, "index.html"), "utf8");
      const at = (href: string) => html.indexOf(`href="/${href}?`);
      assert.ok(at("_handlers.css") > at("styles.css"), "handler styles come after the theme");
      assert.ok(at("user.css") > at("_handlers.css"), "user.css comes after handler styles");
    } finally { await cleanup(v); }
  });

  it("opens the images of a .lightbox-layers element together", async () => {
    const v = await setup({ ".vaultrc.json": VAULTRC_1, "index.md": "# Home\n" });
    try {
      await build(v);
      assert.match(await readFile(join(v.out, "index.html"), "utf8"), /img\.closest\('\.lightbox-layers'\)/);
    } finally { await cleanup(v); }
  });
});
