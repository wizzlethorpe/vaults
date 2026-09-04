// The install box for the module a vault builds for itself.
//
// The URL it shows is only real when the build writes `_foundry/module.json`,
// which needs both a packaging and a site_url. A block on a vault missing
// either would ship a link that 404s, so the build refuses instead.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";
import {
  MANIFEST_PATH, foundryInstallHandler, hasFoundryInstall, parseInstallBlock,
} from "../src/render/handlers/builtin/foundry-install.js";

const BLOCK = "```foundry-install\nlabel: Install it\n```\n";

function render(content: string): string {
  const ctx = {
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  } as never;
  return (foundryInstallHandler.render(content, ctx) as { html: string }).html;
}

describe("foundry-install", () => {
  it("names the manifest the deploy actually serves", () => {
    assert.match(render("label: Install it\n"), new RegExp(`data-path="${MANIFEST_PATH}"`));
  });

  it("takes a label and a note, and needs neither", () => {
    assert.deepEqual(parseInstallBlock("label: Go\nnote: v2\n"), { label: "Go", note: "v2" });
    assert.equal(parseInstallBlock("").label, "Install in Foundry VTT");
  });

  it("escapes a label rather than letting it write markup", () => {
    assert.ok(!render('label: <img src=x onerror="alert(1)">\n').includes("<img"));
  });

  it("sees a block only when the page has one", () => {
    assert.equal(hasFoundryInstall(BLOCK), true);
    assert.equal(hasFoundryInstall("```download\nfile: a.zip\n```\n"), false);
  });
});

/** A vault with the given settings and pages, built into a temp dir. */
async function build(settings: string, pages: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vault-fi-"));
  const out = join(dir, "_out");
  const files = { "settings.md": `---\nimage_quality: 0\n${settings}---\n`, ...pages };
  for (const [p, c] of Object.entries(files)) {
    const full = join(dir, p);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, c);
  }
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { await buildSite({ vaultPath: dir, outputDir: out }); return out; }
  finally { console.log = origLog; console.warn = origWarn; }
}

const page = (body: string) => ({ "index.md": `---\ntitle: Home\n---\n${body}` });

describe("a foundry-install block the build cannot honour", () => {
  it("refuses a vault that packages no module", async () => {
    await assert.rejects(
      () => build('site_url: "https://v.example.com"\nfoundry:\n  package: none\n', page(BLOCK)),
      /foundry.package is "none"/,
    );
  });

  it("refuses a vault with no URL to install from", async () => {
    await assert.rejects(() => build("", page(BLOCK)), /site_url is not set/);
  });

  it("names the pages, so the author knows where to look", async () => {
    await assert.rejects(
      () => build("", { "index.md": "---\ntitle: Home\n---\nBody.\n", "Install.md": `---\ntitle: I\n---\n${BLOCK}` }),
      /Install\.md/,
    );
  });

  it("builds the box into the page when the module is really there", async () => {
    const out = await build('site_url: "https://v.example.com"\n', page(BLOCK));
    const html = await readFile(join(out, "index.html"), "utf8");
    assert.match(html, /vaults-foundry-install/);
    // The runtime reads data-path to build the absolute URL; the page sanitizer
    // strips attributes it does not allow, so pin it on the built page.
    assert.match(html, new RegExp(`data-path="${MANIFEST_PATH}"`));
    await rm(out, { recursive: true, force: true });
  });
});
