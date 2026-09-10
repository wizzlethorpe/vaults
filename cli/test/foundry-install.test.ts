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
import { writeSettingsFile } from "./settings-helpers.js";
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

/** Write a vault's files into `dir`, creating it if it is not there yet. */
async function writeVault(dir: string, settings: string, pages: Record<string, string>) {
  await writeSettingsFile(dir, `image_quality: 0\n${settings}`);
  for (const [p, c] of Object.entries(pages)) {
    const full = join(dir, p);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, c);
  }
}

/** Build `dir` quietly, so a test reads assertions rather than build output. */
async function buildQuietly(dir: string): Promise<string> {
  const out = join(dir, "_out");
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { await buildSite({ vaultPath: dir, outputDir: out }); return out; }
  finally { console.log = origLog; console.warn = origWarn; }
}

/** A vault with the given settings and pages, built into a temp dir. */
async function build(settings: string, pages: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vault-fi-"));
  await writeVault(dir, settings, pages);
  return buildQuietly(dir);
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

const GATED = JSON.stringify({
  roles: ["public", "dm"], rolePasswords: { dm: "100000:0000:0000" },
});

const SITE = 'site_url: "https://v.example.com"\n';

describe("the version the module manifest carries", () => {
  /** A built vault, with what the version came from and a cleanup. */
  async function moduleOf(settings: string, pages: Record<string, string> = {}) {
    const dir = await mkdtemp(join(tmpdir(), "vault-fi-"));
    await writeVault(dir, `${SITE}${settings}`, { ...page("Body.\n"), ...pages });
    const out = await buildQuietly(dir);
    const manifestJson = await readFile(join(out, "_foundry", "module.json"));
    return {
      manifest: JSON.parse(manifestJson.toString()),
      manifestJson,
      /** The stamp the build stored, absent when the author owns the version. */
      stamp: async () => JSON.parse(
        await readFile(join(dir, ".vaults", "config.json"), "utf8")).foundryModule,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  }

  it("stamps a date when the author names no version", async () => {
    const m = await moduleOf("");
    try { assert.match(m.manifest.version, /^\d{4}\.\d+\.\d+(\.\d+)?$/); }
    finally { await m.cleanup(); }
  });

  it("leaves a version from foundry.module alone", async () => {
    // An author numbering their own releases owns the field.
    const m = await moduleOf('foundry:\n  module:\n    version: "1.4.0"\n');
    try { assert.equal(m.manifest.version, "1.4.0"); }
    finally { await m.cleanup(); }
  });

  it("ignores a version the author did not quote", async () => {
    // YAML reads 1.4 as a number, and only a string takes over the numbering.
    const m = await moduleOf("foundry:\n  module:\n    version: 1.4\n");
    try { assert.match(m.manifest.version, /^\d{4}\./); }
    finally { await m.cleanup(); }
  });

  it("fingerprints the files beside the manifest, not just the manifest", async () => {
    // The marker inside module.zip says whether the deploy is gated, and
    // module.json does not, so a fingerprint reading only the manifest hands
    // both deploys the same version and neither is ever offered an update.
    const open = await moduleOf("");
    const gated = await moduleOf("", { ".vaultrc.json": GATED });
    try {
      assert.deepEqual(gated.manifestJson, open.manifestJson);
      assert.notEqual((await gated.stamp()).hash, (await open.stamp()).hash);
    } finally { await open.cleanup(); await gated.cleanup(); }
  });

  it("refuses a version below the one already published", async () => {
    // Foundry compares 1 against 2026 and never offers the update again, which
    // is the failure the date scheme exists to avoid.
    const dir = await mkdtemp(join(tmpdir(), "vault-fi-"));
    try {
      await writeVault(dir, SITE, page("Body.\n"));
      await buildQuietly(dir);
      await writeVault(dir, `${SITE}foundry:\n  module:\n    version: "1.4.0"\n`, {});
      await assert.rejects(() => buildQuietly(dir), /does not order above/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
