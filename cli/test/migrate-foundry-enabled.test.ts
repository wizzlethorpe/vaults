// `foundry.package` becoming `foundry.enabled`. The migration runs once, so a
// vault it misreads as enabled publishes a grafts.json from then on.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../src/settings.js";
import { settingsPath } from "../src/paths.js";
import { runMigrations } from "../src/migrate/run.js";
import { writeSettingsFile } from "./settings-helpers.js";

async function migrated(settings: string) {
  const dir = await mkdtemp(join(tmpdir(), "vaults-foundry-enabled-"));
  await writeSettingsFile(dir, settings);
  await runMigrations(dir, { silent: true });
  const { values } = await loadSettings(dir);
  return { dir, values, raw: await readFile(settingsPath(dir), "utf8") };
}

describe("migration: foundry.package -> foundry.enabled", () => {
  it("carries 'none' across as off", async () => {
    const { dir, values } = await migrated("foundry:\n  package: none\n");
    try {
      assert.equal(values.foundry.enabled, false, "a vault with Foundry off started publishing");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("reads 'none' through a spelling no text match would catch", async () => {
    // Read as a value, not matched as text. A flow mapping is the same
    // setting, and getting it wrong silently re-enables the integration.
    const { dir, values } = await migrated("foundry: { package: none }\n");
    try {
      assert.equal(values.foundry.enabled, false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("treats every other packaging as on", async () => {
    // Written out, not left to the schema default: the default is also on, so
    // the file has to show the migration made the choice.
    const { dir, values, raw } = await migrated("foundry:\n  package: adventure\n");
    try {
      assert.equal(values.foundry.enabled, true);
      assert.match(raw, /enabled: true/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("drops the retired keys and does not run twice", async () => {
    const { dir, raw } = await migrated("foundry:\n  package: none\n  module:\n    authors: [me]\n");
    try {
      assert.doesNotMatch(raw, /^\s+package:/m);
      assert.doesNotMatch(raw, /^\s+module:/m);
      const settled = JSON.parse(await readFile(join(dir, ".vaults/migrations.json"), "utf8")) as string[];
      assert.ok(settled.includes("0.23-foundry-enabled"));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("drops the module's version stamp from config.json, and leaves foundry.enabled alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vaults-foundry-enabled-"));
    try {
      await writeSettingsFile(dir, "foundry:\n  enabled: false\n");
      await writeFile(join(dir, ".vaults/config.json"),
        JSON.stringify({ roles: ["public"], foundryModule: { version: "1.0.0", hash: "abc" } }));
      await runMigrations(dir, { silent: true });
      const config = JSON.parse(await readFile(join(dir, ".vaults/config.json"), "utf8")) as Record<string, unknown>;
      assert.equal("foundryModule" in config, false);
      assert.deepEqual(config["roles"], ["public"]);
      assert.equal((await loadSettings(dir)).values.foundry.enabled, false, "the stamp alone rewrote the setting");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("leaves a vault that never had the key alone", async () => {
    // Untouched, rather than rewritten with a key its author never wrote.
    const { dir, values, raw } = await migrated("vault_name: Plain\n");
    try {
      assert.equal(raw, "vault_name: Plain\n");
      assert.equal(values.foundry.enabled, true, "the default is on");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
