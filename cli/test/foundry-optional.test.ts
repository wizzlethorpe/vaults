// `foundry_package: none` drops the Foundry integration from a deploy.
//
// The importer bundle is ~60KB shipped to every site, and the /_batch
// endpoints are the API the Foundry module syncs through. A course site or a
// research wiki has no use for either, and shouldn't be serving them.
//
// Default is true, so existing vaults are unaffected.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

describe("foundry_package: none", () => {
  it("omits the importer bundle", async () => {
    const out = await build("foundry_package: none\n");
    assert.equal(await exists(join(out, "_foundry/importer.js")), false);
    await rm(out, { recursive: true, force: true });
  });

  it("ships the importer bundle by default", async () => {
    // Default true: an existing vault that never heard of this setting must
    // keep working exactly as before.
    const out = await build("");
    assert.equal(await exists(join(out, "_foundry/importer.js")), true);
    await rm(out, { recursive: true, force: true });
  });

  it("stops advertising Foundry handler assets in the manifest", async () => {
    const on = JSON.parse(await readFile(join(await build(""), "_manifest.json"), "utf8"));
    const off = JSON.parse(await readFile(join(await build("foundry_package: none\n"), "_manifest.json"), "utf8"));
    assert.equal(off.assets?.foundry, undefined);
    // The browser bundles are unrelated and must survive.
    assert.ok(off.assets?.browser, "browser handler assets are not Foundry-specific");
    assert.deepEqual(off.assets.browser, on.assets.browser);
  });

  it("leaves the rest of the deploy untouched", async () => {
    const out = await build("foundry_package: none\n");
    for (const f of ["index.html", "index.body.html", "_search-index.json", "styles.css", "_manifest.json"]) {
      assert.equal(await exists(join(out, f)), true, `${f} must still ship`);
    }
    await rm(out, { recursive: true, force: true });
  });

  it("keeps foundry: frontmatter in the manifest either way", async () => {
    // The setting controls what the deploy *serves*, not what pages may say.
    // A vault can flip it back on without editing every page.
    const page = { "NPC.md": '---\ntitle: Bob\nfoundry:\n  base: "Actor:npc"\n---\nBob.\n' };
    const out = await build("foundry_package: none\n", page);
    const m = JSON.parse(await readFile(join(out, "_manifest.json"), "utf8"));
    const row = m.files.find((f: { path: string }) => f.path === "NPC.body.html");
    assert.equal(row?.meta?.foundry?.base, "Actor:npc");
    await rm(out, { recursive: true, force: true });
  });
});

describe("foundry_package validation", () => {
  it("rejects a value outside the vocabulary and falls back", async () => {
    // A typo here used to be impossible: the setting was a boolean. Now it
    // names a packaging shape, and an unrecognised one that silently became
    // the default would give the vault a Foundry layout its author did not
    // ask for, with links baked to match.
    const { loadSettings } = await import("../src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeFile(join(dir, "settings.md"), "---\nfoundry_package: adventurte\n---\n");
    const parsed = await loadSettings(dir);
    assert.equal(parsed.values.foundry_package, "compendium");
    assert.match(parsed.warnings.join("\n"), /one of none, compendium, adventure/);
  });

  it("accepts each of the three", async () => {
    const { loadSettings } = await import("../src/settings.js");
    for (const want of ["none", "compendium", "adventure"] as const) {
      const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
      await writeFile(join(dir, "settings.md"), `---\nfoundry_package: ${want}\n---\n`);
      const parsed = await loadSettings(dir);
      assert.equal(parsed.values.foundry_package, want);
      assert.deepEqual(parsed.warnings, []);
    }
  });
});
