// `default_frontmatter` survives a round trip through the schema.
//
// This setting is the one that decides what a page's role is when the page
// does not say. Rejecting a valid value here does not fail the build: the
// schema substitutes its own default (`role: public`), the canonical rewriter
// then writes that default back over the vault's settings file, and every
// unmarked page in a private vault becomes world-readable. The build says
// only that it "rewrote settings.yaml to canonical format".
//
// So the thing under test is not really the predicate. It is that a vault
// which says `role: DM` still says `role: DM` after being read.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSettings, writeSettings } from "../src/settings.js";
import { settingsPath } from "../src/paths.js";
import { writeSettingsFile } from "./settings-helpers.js";

async function vaultWith(yaml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
  await writeSettingsFile(dir, `${yaml}\n`);
  return dir;
}

const PRIVATE_BASELINE = `default_frontmatter:
  - match: '**'
    data:
      role: DM`;

describe("default_frontmatter round trip", () => {
  it("keeps a rule keyed on 'data', which is the key the schema documents", async () => {
    const { values, warnings } = await loadSettings(await vaultWith(PRIVATE_BASELINE));
    assert.deepEqual(values.default_frontmatter, [{ match: "**", data: { role: "DM" } }]);
    assert.deepEqual(warnings.filter((w) => w.includes("default_frontmatter")), []);
  });

  it("never silently downgrades a private baseline to public", async () => {
    // The failure this guards is not a crash. It is a vault whose DM notes
    // quietly start rendering into the public variant.
    const { values } = await loadSettings(await vaultWith(PRIVATE_BASELINE));
    const roles = values.default_frontmatter.map((r) => r.data["role"]);
    assert.deepEqual(roles, ["DM"]);
  });

  it("settles: a canonical write reloads unchanged, with the value intact", async () => {
    // `changed` is what makes the build write the settings file back. A canonical
    // file still reporting changed would rewrite on every build, and a
    // substituted default reaching the rewriter is how a private baseline
    // lands on disk as public.
    const dir = await vaultWith(PRIVATE_BASELINE);
    const first = await loadSettings(dir);
    await writeSettings(dir, first.values);
    const second = await loadSettings(dir);
    assert.equal(second.changed, false, await readFile(settingsPath(dir), "utf8"));
    assert.equal(second.values.default_frontmatter[0]!.data["role"], "DM");
  });

  it("carries several rules in order, since later ones merge over earlier", async () => {
    const { values } = await loadSettings(await vaultWith(`default_frontmatter:
  - match: '**'
    data:
      role: DM
  - match: 'Public/**'
    data:
      role: public`));
    assert.deepEqual(values.default_frontmatter.map((r) => r.match), ["**", "Public/**"]);
  });

  it("still rejects a rule with no data, which would supply nothing", async () => {
    const { values, warnings } = await loadSettings(await vaultWith(`default_frontmatter:
  - match: '**'`));
    assert.equal(values.default_frontmatter[0]!.data["role"], "public");
    assert.ok(warnings.some((w) => w.includes("default_frontmatter")));
  });
});
