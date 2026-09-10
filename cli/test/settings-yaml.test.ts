// The 0.22 move of settings.md into .vaults/settings.yaml, and the
// `vaults set` / `vaults get` commands that replace hand-editing it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../src/settings.js";
import { legacySettingsPath, settingsPath } from "../src/paths.js";
import { runMigrations } from "../src/migrate/run.js";
import { settingsGet, settingsSet } from "../src/commands/settings.js";
import { writeSettingsFile } from "./settings-helpers.js";

async function vault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "vaults-settings-yaml-"));
}

/** A vault `vaults set` will act on: one that has been initialised. */
async function initialised(settings = ""): Promise<string> {
  const dir = await vault();
  await writeSettingsFile(dir, settings);
  return dir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Run `fn` with console output captured rather than printed. */
async function quiet(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const origLog = console.log, origWarn = console.warn;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.log = origLog; console.warn = origWarn; }
  return lines;
}

describe("migration: settings.md → .vaults/settings.yaml", () => {
  it("moves the values and removes the old file", async () => {
    const dir = await vault();
    try {
      await writeFile(legacySettingsPath(dir),
        "---\nvault_name: Bitter Brine\nimage_quality: 40\n---\n\n# Vault settings\n");
      await runMigrations(dir, { silent: true });

      assert.equal(await exists(legacySettingsPath(dir)), false,
        "the old settings.md is still in the vault, where Obsidian shows it");
      const { values, exists: found } = await loadSettings(dir);
      assert.equal(found, true);
      assert.equal(values.vault_name, "Bitter Brine");
      assert.equal(values.image_quality, 40);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("writes YAML, not a markdown file with frontmatter", async () => {
    const dir = await vault();
    try {
      await writeFile(legacySettingsPath(dir), "---\nvault_name: Bitter Brine\n---\n");
      await runMigrations(dir, { silent: true });
      const raw = await readFile(settingsPath(dir), "utf8");
      assert.doesNotMatch(raw, /^---/, "the frontmatter fence came along with the values");
      assert.match(raw, /^vault_name: Bitter Brine$/m);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("leaves an already-migrated vault alone", async () => {
    const dir = await vault();
    try {
      await writeSettingsFile(dir, "vault_name: Current\n");
      await writeFile(legacySettingsPath(dir), "---\nvault_name: Stale\n---\n");
      await runMigrations(dir, { silent: true });
      const { values } = await loadSettings(dir);
      assert.equal(values.vault_name, "Current",
        "a stray settings.md overwrote the settings the vault is actually using");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("vaults set", () => {
  it("writes a scalar and reads it back", async () => {
    const dir = await initialised();
    try {
      await quiet(() => settingsSet("auto_image", "false", dir));
      const { values } = await loadSettings(dir);
      assert.equal(values.auto_image, false, "the value did not survive the round trip");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("takes a string setting verbatim, so a '#' colour is not a YAML comment", async () => {
    const dir = await initialised();
    try {
      await quiet(() => settingsSet("accent_color", "#7a4a8c", dir));
      const { values } = await loadSettings(dir);
      assert.equal(values.accent_color, "#7a4a8c");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("takes a nested foundry key without disturbing its siblings", async () => {
    const dir = await initialised();
    try {
      await quiet(() => settingsSet("foundry.package", "adventure", dir));
      await quiet(() => settingsSet("foundry.system", "pf2e", dir));
      const { values } = await loadSettings(dir);
      assert.equal(values.foundry.package, "adventure");
      assert.equal(values.foundry.system, "pf2e");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("keeps foundry.core_version a string, since YAML would make 14.359 a number", async () => {
    const dir = await initialised();
    try {
      await quiet(() => settingsSet("foundry.core_version", "14.359", dir));
      const { values, warnings } = await loadSettings(dir);
      assert.equal(values.foundry.core_version, "14.359");
      assert.deepEqual(warnings, [], "the value was stored as a number and warned about on read");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses a value outside a setting's vocabulary instead of storing a default", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("foundry.package", "adventurte", dir),
        /Refusing to set 'foundry.package'/);
      const { values } = await loadSettings(dir);
      assert.equal(values.foundry.package, "compendium");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses a value of the wrong type", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("image_quality", "high", dir), /Refusing to set/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses a value the schema warns about but does not replace", async () => {
    // foundry.module.version only warns, so comparing the stored value against
    // the input says nothing. Written, it is a number the build then ignores.
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("foundry.module.version", "1.4", dir),
        /Refusing to set 'foundry.module.version'/);
      const { values } = await loadSettings(dir);
      assert.deepEqual(values.foundry.module, {});
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("names the value it rejected", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("image_quality", "high", dir), /to "high"/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses a nested key on a setting that has none", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("vault_name.x", "y", dir), /has no nested keys/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses to act on a directory that is not a vault", async () => {
    // Otherwise a mistyped cwd silently grows a .vaults/ of its own.
    const dir = await vault();
    try {
      await assert.rejects(() => settingsSet("vault_name", "X", dir), /Not a vaults-initialised/);
      assert.equal(await exists(settingsPath(dir)), false, "set created a vault where there was none");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses an unknown setting rather than writing a key the build ignores", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("acccent_color", "red", dir), /Unknown setting/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("rewrites the whole file canonically, dropping a key the schema retired", async () => {
    const dir = await initialised("vault_name: Keep\nlegacy_key: drop me\n");
    try {
      await quiet(() => settingsSet("auto_image", "false", dir));
      const raw = await readFile(settingsPath(dir), "utf8");
      assert.doesNotMatch(raw, /legacy_key/, "an unknown key survived a canonical rewrite");
      assert.match(raw, /^vault_name: Keep$/m, "the rewrite dropped a value it should have kept");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("vaults get", () => {
  it("prints one value bare, so it can be piped", async () => {
    const dir = await initialised("vault_name: Bitter Brine\n");
    try {
      const out = await quiet(() => settingsGet("vault_name", dir));
      assert.deepEqual(out, ["Bitter Brine"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("lists every setting when given no key", async () => {
    const dir = await initialised("vault_name: Bitter Brine\n");
    try {
      const out = await quiet(() => settingsGet(undefined, dir));
      assert.ok(out.some((l) => l.startsWith("auto_image:")), "a schema key was missing from the listing");
      assert.ok(out.some((l) => l.startsWith("site_url:")), "a schema key was missing from the listing");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
