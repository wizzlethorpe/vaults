// `foundry.package: none` drops the Foundry integration from a deploy.
//
// The /_batch endpoints are the API the Foundry provider reads through, and
// `_foundry/` holds the module a reader installs. A course site or a research
// wiki has no use for either, and shouldn't be serving them.
//
// Default is true, so existing vaults are unaffected.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

async function build(settings: string, extra: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vault-fo-"));
  const out = join(dir, "_out");
  const files = {
    "settings.md": `---\nimage_quality: 0\n${settings}---\n`,
    "index.md": "---\ntitle: Home\n---\nBody.\n",
    ...extra,
  };
  for (const [p, c] of Object.entries(files)) {
    const full = join(dir, p);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, c);
  }
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { await buildSite({ vaultPath: dir, outputDir: out }); }
  finally { console.log = origLog; console.warn = origWarn; }
  return out;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

describe("foundry.package: none", () => {
  it("omits the entry list a reader would build from", async () => {
    const out = await build("foundry:\n  package: none\n");
    assert.equal(await exists(join(out, "_foundry/grafts.json")), false);
    await rm(out, { recursive: true, force: true });
  });

  it("ships one by default", async () => {
    // Default is on: a vault that never heard of this setting keeps working.
    const out = await build("");
    assert.equal(await exists(join(out, "_foundry/grafts.json")), true);
    await rm(out, { recursive: true, force: true });
  });

  it("ships the installable module only once the vault knows its own URL", async () => {
    // module.json names the vault it reads from, so a deploy that cannot say
    // where it lives would produce a module pointing at nothing.
    const without = await build("");
    assert.equal(await exists(join(without, "_foundry/module.json")), false);
    const withUrl = await build('site_url: "https://v.example.com"\n');
    assert.equal(await exists(join(withUrl, "_foundry/module.json")), true);
    assert.equal(await exists(join(withUrl, "_foundry/version.json")), true);
    await rm(without, { recursive: true, force: true });
    await rm(withUrl, { recursive: true, force: true });
  });


  it("leaves the rest of the deploy untouched", async () => {
    const out = await build("foundry:\n  package: none\n");
    for (const f of ["index.html", "index.body.html", "_search-index.json", "styles.css"]) {
      assert.equal(await exists(join(out, f)), true, `${f} must still ship`);
    }
    await rm(out, { recursive: true, force: true });
  });

});

describe("foundry.package validation", () => {
  it("rejects a value outside the vocabulary and falls back", async () => {
    // A typo here used to be impossible: the setting was a boolean. Now it
    // names a packaging shape, and an unrecognised one that silently became
    // the default would give the vault a Foundry layout its author did not
    // ask for, with links baked to match.
    const { loadSettings } = await import("../src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeFile(join(dir, "settings.md"), "---\nfoundry:\n  package: adventurte\n---\n");
    const parsed = await loadSettings(dir);
    assert.equal(parsed.values.foundry.package, "compendium");
    assert.match(parsed.warnings.join("\n"), /one of none, compendium, adventure/);
  });

  it("accepts each of the three", async () => {
    const { loadSettings } = await import("../src/settings.js");
    for (const want of ["none", "compendium", "adventure"] as const) {
      const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
      await writeFile(join(dir, "settings.md"), `---\nfoundry:\n  package: ${want}\n---\n`);
      const parsed = await loadSettings(dir);
      assert.equal(parsed.values.foundry.package, want);
      assert.deepEqual(parsed.warnings, []);
    }
  });
});

describe("the foundry block", () => {
  it("takes defaults for the keys a vault does not state", async () => {
    const { loadSettings } = await import("../src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeFile(join(dir, "settings.md"), "---\nfoundry:\n  player_role: dm\n---\n");
    const { values, warnings } = await loadSettings(dir);
    assert.equal(values.foundry.player_role, "dm");
    assert.equal(values.foundry.package, "compendium", "unstated keys keep their default");
    assert.deepEqual(values.foundry.module, {});
    assert.deepEqual(warnings, []);
  });

  it("names a misspelled subkey instead of reading it as unset", async () => {
    // The generic type check only asks whether it is an object. Without this a
    // typo reads as an absent key, which is a default rather than a mistake —
    // `player_roll: dm` would silently share nothing.
    const { loadSettings } = await import("../src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeFile(join(dir, "settings.md"), "---\nfoundry:\n  player_roll: dm\n---\n");
    const { values, warnings } = await loadSettings(dir);
    assert.match(warnings.join("\n"), /unknown key 'foundry\.player_roll'/);
    assert.equal(values.foundry.player_role, "");
  });

  it("keeps an arbitrary manifest under module", async () => {
    // Whatever Foundry accepts in a module.json, since that is what it becomes.
    const { loadSettings } = await import("../src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeFile(join(dir, "settings.md"),
      "---\nfoundry:\n  module:\n    id: x\n    relationships:\n      requires:\n        - id: dnd5e\n---\n");
    const { values } = await loadSettings(dir);
    assert.equal(values.foundry.module["id"], "x");
    assert.ok(values.foundry.module["relationships"], "nested structure survives the round trip");
  });
});

describe("site_url with the Foundry integration on", () => {
  /** Build and return the warnings, since that is what is under test here. */
  async function warningsFrom(settings: string): Promise<{ out: string; warnings: string[] }> {
    const dir = await mkdtemp(join(tmpdir(), "vault-su-"));
    const out = join(dir, "_out");
    await writeFile(join(dir, "settings.md"), `---\nimage_quality: 0\n${settings}---\n`);
    await writeFile(join(dir, "index.md"), "---\ntitle: Home\n---\nBody.\n");
    const warnings: string[] = [];
    const origLog = console.log, origWarn = console.warn;
    console.log = () => {};
    console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
    try { await buildSite({ vaultPath: dir, outputDir: out }); }
    finally { console.log = origLog; console.warn = origWarn; }
    return { out, warnings };
  }

  it("says so when there is no URL to install the module from", async () => {
    // The module is only written when a URL exists to fetch the vault from, so
    // without one the deploy succeeds and Foundry has nothing to install.
    const { out, warnings } = await warningsFrom("site_url: \"\"\n");
    assert.match(warnings.join("\n"), /site_url is not set, so no Foundry module is written/);
    assert.equal(await exists(join(out, "_foundry/module.json")), false);
    await rm(out, { recursive: true, force: true });
  });

  it("is quiet, and writes the module, once one is set", async () => {
    const { out, warnings } = await warningsFrom("site_url: \"https://notes.example.com\"\n");
    assert.doesNotMatch(warnings.join("\n"), /site_url is not set/);
    assert.equal(await exists(join(out, "_foundry/module.json")), true);
    await rm(out, { recursive: true, force: true });
  });

  it("stays quiet when the integration is off", async () => {
    const { out, warnings } = await warningsFrom("site_url: \"\"\nfoundry:\n  package: none\n");
    assert.doesNotMatch(warnings.join("\n"), /site_url is not set/);
    await rm(out, { recursive: true, force: true });
  });
});
