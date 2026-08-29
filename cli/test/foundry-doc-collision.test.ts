// Two pages must not instantiate documents Foundry can't tell apart.
//
// The vault directory is the default Foundry folder, so the filesystem stops
// most collisions — but not all. The document name is the page's `title:`
// when present, so two differently named files in one directory can still
// land on the same name; and a foundry.folder override can gather pages from
// different directories into one folder. Nothing else catches either, and the
// result in Foundry is two identical-looking documents.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

async function build(files: Record<string, string>): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "vault-dupdoc-"));
  const all = { "settings.md": "---\nimage_quality: 0\n---\n", ...files };
  for (const [path, content] of Object.entries(all)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  const warnings: string[] = [];
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {};
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
  try {
    await buildSite({ vaultPath: dir, outputDir: join(dir, "_out") });
  } finally {
    console.log = origLog; console.warn = origWarn;
    await rm(dir, { recursive: true, force: true });
  }
  return warnings.filter((w) => w.includes("same Foundry"));
}

const page = (title: string, extra = "") =>
  `---\ntitle: ${title}\nfoundry:\n  source: Actor:npc\n${extra}---\nBody.\n`;

describe("duplicate Foundry documents", () => {
  it("catches two titles colliding in one directory", async () => {
    // The case the filesystem cannot prevent: distinct filenames, same title.
    const warnings = await build({
      "NPCs/Bob.md": page("Robert Vane"),
      "NPCs/Robert.md": page("Robert Vane"),
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Robert Vane/);
    assert.match(warnings[0]!, /NPCs\/Bob\.md/);
  });

  it("catches a foundry.folder override gathering two pages into one folder", async () => {
    const warnings = await build({
      "Alpha/Guard.md": page("Guard", "  folder: Shared\n"),
      "Zulu/Guard.md": page("Guard", "  folder: Shared\n"),
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Shared/);
  });

  it("allows the same name in different directories", async () => {
    // This is the whole point of mirroring the vault tree.
    assert.deepEqual(await build({
      "Alpha/Guard.md": page("Guard"),
      "Zulu/Guard.md": page("Guard"),
    }), []);
  });

  it("allows the same name for different document types", async () => {
    assert.deepEqual(await build({
      "Things/Sword.md": "---\ntitle: Sword\nfoundry:\n  source: Actor:npc\n---\nA.\n",
      "Things/Sword Item.md": "---\ntitle: Sword\nfoundry:\n  source: Item:weapon\n---\nB.\n",
    }), []);
  });

  it("catches two Scene UUID bases colliding", async () => {
    // Cloning from a UUID used to be Actor/Item only, so this pair created
    // nothing and was deliberately not reported. Scenes are cloneable now —
    // which is the point, since map packs ship their content as compendium
    // Scenes — so two of them really would land in one folder under one name.
    const warnings = await build({
      "Scenes/A.md": '---\ntitle: Great Hall\nfoundry:\n  source: "Compendium.x.y.Scene.aaaaaaaaaaaaaaaa"\n---\nA.\n',
      "Scenes/B.md": '---\ntitle: Great Hall\nfoundry:\n  source: "Compendium.x.y.Scene.bbbbbbbbbbbbbbbb"\n---\nB.\n',
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Scene named 'Great Hall'/);
  });

  it("ignores a base naming a type vaults cannot instantiate", async () => {
    // Foundry may resolve a Combat UUID, but vaults has no world collection
    // for it, so no document is created and a collision is not a thing.
    assert.deepEqual(await build({
      "Things/A.md": '---\ntitle: Skirmish\nfoundry:\n  source: "Compendium.x.y.Combat.aaaaaaaaaaaaaaaa"\n---\nA.\n',
      "Things/B.md": '---\ntitle: Skirmish\nfoundry:\n  source: "Compendium.x.y.Combat.bbbbbbbbbbbbbbbb"\n---\nB.\n',
    }), []);
  });

  it("ignores pages that instantiate nothing", async () => {
    assert.deepEqual(await build({
      "NPCs/Bob.md": "---\ntitle: Robert Vane\n---\nNo foundry block.\n",
      "NPCs/Robert.md": "---\ntitle: Robert Vane\n---\nNor here.\n",
    }), []);
  });
});
