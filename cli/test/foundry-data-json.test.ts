// Regression tests for staging assets referenced inside a page's
// foundry.data_json file.
//
// A Scene page carries the bulk of its asset references (backgrounds, ambient
// sounds, tile art) inside the JSON file named by `foundry.data_json`, not in
// the page frontmatter. The per-variant asset scanners must consult that JSON
// content; otherwise the assets never ship and Foundry sync 404s them. These
// build end-to-end via buildSite() so a regression in the scan path is caught.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; out: string; }

async function setupVault(files: Record<string, string>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-fdj-"));
  const out = join(dir, "_out");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return { dir, out };
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

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

const scenePage = (dataJson: string, role?: string) =>
  `---\n${role ? `role: ${role}\n` : ""}foundry:\n  base: Scene\n  data_json: ${dataJson}\n---\n# Scene\n`;

const sceneJson = (audioRef: string) =>
  JSON.stringify({ name: "Scene", sounds: [{ path: audioRef }] });

describe("foundry.data_json asset staging", () => {
  it("stages an @vault asset referenced inside the data_json file", async () => {
    const v = await setupVault({
      ".vaultrc.json": JSON.stringify({ roles: ["public"], rolePasswords: {} }),
      "Maps/Keep.md": scenePage("scenes/keep.json"),
      "scenes/keep.json": sceneJson("@vault/attachments/ambient.ogg"),
      "attachments/ambient.ogg": "FAKE OGG BYTES",
    });
    try {
      await build(v);
      // Single-role build collapses to the deploy root.
      assert.equal(
        await exists(join(v.out, "attachments/ambient.ogg")), true,
        "audio referenced only inside data_json must ship",
      );
    } finally { await rm(v.dir, { recursive: true, force: true }); }
  });

  it("gates a data_json asset by the scene page's role", async () => {
    const v = await setupVault({
      ".vaultrc.json": JSON.stringify({
        roles: ["public", "dm"],
        rolePasswords: { dm: "100000:0000:0000" },
      }),
      "Maps/Secret.md": scenePage("scenes/secret.json", "dm"),
      "scenes/secret.json": sceneJson("@vault/attachments/secret.ogg"),
      "attachments/secret.ogg": "FAKE OGG BYTES",
    });
    try {
      await build(v);
      assert.equal(
        await exists(join(v.out, "_variants/public/attachments/secret.ogg")), false,
        "a DM scene's data_json audio must not leak to the public variant",
      );
      assert.equal(
        await exists(join(v.out, "_variants/dm/attachments/secret.ogg")), true,
        "the DM variant should receive the audio its scene references",
      );
    } finally { await rm(v.dir, { recursive: true, force: true }); }
  });
});
