// `vaults set` and `vaults get` over the settings the add-on contributes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { loadSettings } from "../../cli/src/settings.js";
import { settingsPath } from "../../cli/src/paths.js";
import { settingsGet, settingsSet } from "../../cli/src/commands/settings.js";
import type { TtrpgSettings } from "../src/foundry-settings.js";
import { initialised, quiet } from "../../cli/test/settings-helpers.js";

describe("vaults set", () => {
  it("takes a nested foundry key without disturbing its siblings", async () => {
    const dir = await initialised();
    try {
      await quiet(() => settingsSet("foundry.enabled", "false", dir));
      await quiet(() => settingsSet("foundry.system", "pf2e", dir));
      const { values } = await loadSettings(dir);
      assert.equal((values as TtrpgSettings).foundry.enabled, false);
      assert.equal((values as TtrpgSettings).foundry.system, "pf2e");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("keeps foundry.core_version a string, since YAML would make 14.359 a number", async () => {
    const dir = await initialised();
    try {
      await quiet(() => settingsSet("foundry.core_version", "14.359", dir));
      const { values, warnings } = await loadSettings(dir);
      assert.equal((values as TtrpgSettings).foundry.core_version, "14.359");
      assert.deepEqual(warnings, [], "the value was stored as a number and warned about on read");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses a value of the wrong type inside the foundry block", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("foundry.enabled", "yes please", dir),
        /Refusing to set 'foundry.enabled'/);
      const { values } = await loadSettings(dir);
      assert.equal((values as TtrpgSettings).foundry.enabled, true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses a key the foundry block does not know, set alone or inside the whole block", async () => {
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("foundry.sytem", "pf2e", dir), /unknown key 'foundry\.sytem'/);
      await assert.rejects(
        () => settingsSet("foundry", "{enabled: true, player_role: '', system: dnd5e, core_version: '', package: none}", dir),
        /unknown key 'foundry\.package'/);
      assert.doesNotMatch(await readFile(settingsPath(dir), "utf8"), /sytem|package:/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses a value the schema warns about but does not replace", async () => {
    // A bare generation warns without being replaced, so comparing the stored
    // value against the input says nothing. Written, it costs a Scene its levels.
    const dir = await initialised();
    try {
      await assert.rejects(() => settingsSet("foundry.core_version", "14", dir),
        /Refusing to set 'foundry.core_version'/);
      const { values } = await loadSettings(dir);
      assert.equal((values as TtrpgSettings).foundry.core_version, "");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("keeps a subkey named like an Object.prototype member, as it would any other", async () => {
    const dir = await initialised("foundry:\n  constructor: nested\n");
    try {
      await quiet(() => settingsSet("auto_image", "false", dir));
      assert.match(await readFile(settingsPath(dir), "utf8"), /^  constructor: nested$/m);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("does not suggest installing the add-on that is already loaded", async () => {
    const dir = await initialised("other_tool: 1\n");
    try {
      const { warnings } = await loadSettings(dir);
      assert.deepEqual(warnings, ["settings.yaml: unknown setting 'other_tool' is ignored."]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("vaults get", () => {
  it("lists the add-on's settings after core's", async () => {
    const dir = await initialised();
    try {
      const out = await quiet(() => settingsGet(undefined, dir));
      const at = (key: string) => out.findIndex((l) => l.startsWith(`${key}:`));
      assert.ok(at("foundry") > at("site_url") && at("zip_assets") > at("site_url"), out.join("\n"));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
