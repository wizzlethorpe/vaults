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
import { complainsAbout, settingsGet, settingsSet } from "../src/commands/settings.js";
import { initialised, quiet, writeSettingsFile } from "./settings-helpers.js";

async function vault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "vaults-settings-yaml-"));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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

  it("refuses a value of the wrong type", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("image_quality", "high", dir), /Refusing to set/);
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

  it("says which package may own a setting it does not know", async () => {
    const dir = await initialised("foundry:\n  enabled: false\n");
    try {
      await assert.rejects(() => settingsSet("foundry.enabled", "true", dir), /Unknown setting 'foundry'.*install that beside the CLI/);
      assert.match(await readFile(settingsPath(dir), "utf8"), /^foundry:\n  enabled: false$/m, "the block it does not own was touched");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses an unknown setting rather than writing a key the build ignores", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("acccent_color", "red", dir), /Unknown setting/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("rewrites the file canonically and keeps a key the schema does not know", async () => {
    const dir = await initialised("other_tool:\n  depth: 2\nvault_name: Keep\n");
    try {
      await quiet(() => settingsSet("auto_image", "false", dir));
      const raw = await readFile(settingsPath(dir), "utf8");
      assert.match(raw, /^vault_name: Keep$/m);
      assert.match(raw, /^other_tool:\n  depth: 2$/m, "a canonical rewrite cost the vault a key the CLI does not own");
      assert.ok(raw.indexOf("other_tool:") > raw.indexOf("site_url:"), "unknown keys follow the schema's");
      const { warnings, changed } = await loadSettings(dir);
      assert.match(warnings.join("\n"), /unknown setting 'other_tool' is ignored\. If it belongs to @wizzlethorpe\/vaults-ttrpg, install that beside the CLI\./);
      assert.equal(changed, false, "a file holding an unknown key would be rewritten on every build");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("treats a key named like an Object.prototype member as any other unknown key", async () => {
    const dir = await initialised("constructor: mine\ntoString: also mine\n__proto__:\n  depth: 2\n");
    try {
      await quiet(() => settingsSet("auto_image", "false", dir));
      const raw = await readFile(settingsPath(dir), "utf8");
      assert.match(raw, /^constructor: mine$/m);
      assert.match(raw, /^toString: also mine$/m);
      assert.match(raw, /^__proto__:\n  depth: 2$/m);
      const { warnings } = await loadSettings(dir);
      assert.match(warnings.join("\n"), /unknown setting 'constructor' is ignored/);
      await assert.rejects(quiet(() => settingsSet("constructor", "x", dir)), /Unknown setting 'constructor'/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("complainsAbout", () => {
  const warning = "settings.yaml: unknown key 'foundry.package' is ignored. Known: enabled.";

  it("matches the key named, a key it sits inside, and a key inside it", () => {
    assert.equal(complainsAbout(warning, "foundry.package"), true);
    assert.equal(complainsAbout(warning, "foundry"), true);
    assert.equal(complainsAbout(warning, "foundry.package.id"), true);
  });

  it("does not match a sibling or a key that only shares a prefix", () => {
    assert.equal(complainsAbout(warning, "foundry.system"), false);
    assert.equal(complainsAbout(warning, "foundry.pack"), false);
    assert.equal(complainsAbout("settings.yaml: 'foundry_x' should be a string", "foundry"), false);
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
