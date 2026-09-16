// The box offering a reader their own grafts.json.
//
// The link is only real when the build writes one, which needs the Foundry
// integration on and a site_url. A block on a vault missing either would ship
// a link that 404s, so the build refuses instead.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";
import { writeSettingsFile } from "./settings-helpers.js";
import {
  GRAFTS_PATH, foundryInstallHandler, hasFoundryInstall, parseInstallBlock,
} from "../src/render/handlers/builtin/foundry-install.js";

const BLOCK = "```foundry-install\nlabel: Install it\n```\n";

function render(content: string): string {
  const ctx = {
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  } as never;
  return (foundryInstallHandler.render(content, ctx) as { html: string }).html;
}

describe("foundry-install", () => {
  it("links to the entry list the deploy actually serves", () => {
    assert.match(render("label: Install it\n"), new RegExp(`href="${GRAFTS_PATH}"`));
  });

  it("takes a label and a note, and needs neither", () => {
    assert.deepEqual(parseInstallBlock("label: Go\nnote: v2\n"), { label: "Go", note: "v2" });
    assert.equal(parseInstallBlock("").label, "Add to Foundry VTT");
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
  it("refuses a vault with the integration off", async () => {
    await assert.rejects(
      () => build('site_url: "https://v.example.com"\nfoundry:\n  enabled: false\n', page(BLOCK)),
      /foundry.enabled is false/,
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
    // The page sanitizer strips attributes it does not allow, so pin the
    // download link on the built page rather than on the handler's output.
    assert.match(html, new RegExp(`href="${GRAFTS_PATH}"`));
    assert.match(html, /download="grafts\.json"/);
    await rm(out, { recursive: true, force: true });
  });
});


