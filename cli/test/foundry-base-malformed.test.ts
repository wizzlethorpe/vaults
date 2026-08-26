// Regression tests for `foundry.base` validation.
//
// `base` is one spec or a priority list. An unusable value is dropped from the
// manifest meta with a warning rather than failing the build, mirroring how
// foundry.id has always handled a malformed value. Dropping it silently (the
// old behaviour) meant the page synced as a journal with no Actor and nothing
// anywhere said why — the module never receives the key, so it can't report
// the page either.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; out: string; }

async function setupVault(files: Record<string, string>): Promise<Vault> {
  // settings.md is the source of truth for vault properties, so a test vault
  // configures itself the way a user would. image_quality: 0 skips sharp,
  // which these fixtures need: their "images" are placeholder bytes, not real
  // encodings. Exercising the compression path wants real fixtures instead.
  if (!("settings.md" in files)) {
    files = { "settings.md": "---\nimage_quality: 0\n---\n", ...files };
  }
  const dir = await mkdtemp(join(tmpdir(), "vault-fbm-"));
  const out = join(dir, "_out");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return { dir, out };
}

/** Build, capturing warnings so a test can assert on what the user was told. */
async function build(v: Vault): Promise<string[]> {
  const warnings: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    await buildSite({
      vaultPath: v.dir,
      outputDir: v.out,
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return warnings;
}

interface ManifestFile { path: string; meta?: { foundry?: Record<string, unknown> } }

async function metaFor(v: Vault, bodyPath: string): Promise<ManifestFile["meta"]> {
  const raw = await readFile(join(v.out, "_manifest.json"), "utf8");
  const manifest = JSON.parse(raw) as { files: ManifestFile[] };
  const row = manifest.files.find((f) => f.path === bodyPath);
  assert.ok(row, `no manifest row for ${bodyPath}`);
  return row.meta;
}

describe("foundry.base validation", () => {
  it("rejects a base entry that is not a string, and names the page", async () => {
    const v = await setupVault({
      "Guard.md": "---\nfoundry:\n  base:\n  - 42\n  - \"Actor:npc\"\n---\nGuard.\n",
    });
    try {
      const warnings = await build(v);
      const hit = warnings.find((w) => w.includes("foundry.base"));
      assert.ok(hit, `expected a foundry.base warning, got: ${JSON.stringify(warnings)}`);
      assert.match(hit, /Guard\.md/);
      const meta = await metaFor(v, "Guard.body.html");
      assert.equal(meta?.foundry?.base, undefined);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("rejects a list whose entries name different document types", async () => {
    const v = await setupVault({
      "Guard.md": '---\nfoundry:\n  base:\n  - "Compendium.a.items.Item.aaaaaaaaaaaaaaaa"\n  - "Actor:npc"\n  embed: true\n---\nGuard.\n',
    });
    try {
      const warnings = await build(v);
      const hit = warnings.find((w) => w.includes("same document type"));
      assert.ok(hit, `expected a mixed-type warning, got: ${JSON.stringify(warnings)}`);
      assert.match(hit, /Item/);
      assert.match(hit, /Actor/);
      const meta = await metaFor(v, "Guard.body.html");
      assert.equal(meta?.foundry?.base, undefined);
      // Sibling keys in the same block survive; only `base` is rejected.
      assert.equal(meta?.foundry?.embed, true);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("still renders the page to the wiki when its base was rejected", async () => {
    const v = await setupVault({
      "Guard.md": '---\nfoundry:\n  base:\n  - "Compendium.a.items.Item.aaaaaaaaaaaaaaaa"\n  - "Actor:npc"\n---\nGuard prose.\n',
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Guard.body.html"), "utf8");
      assert.match(html, /Guard prose\./);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("says nothing when base is a well-formed string", async () => {
    const v = await setupVault({
      "Guard.md": '---\nfoundry:\n  base: "Actor:npc"\n---\nGuard.\n',
    });
    try {
      const warnings = await build(v);
      assert.equal(warnings.filter((w) => w.includes("foundry.base")).length, 0);
      const meta = await metaFor(v, "Guard.body.html");
      assert.equal(meta?.foundry?.base, "Actor:npc");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("forwards a valid priority list to the manifest as a list", async () => {
    const v = await setupVault({
      "Guard.md": '---\nfoundry:\n  base:\n  - "Compendium.dnd-monster-manual.actors.Actor.mmGuard000000000"\n  - "Compendium.dnd5e.actors24.Actor.mmGuard000000000"\n  - "Actor:npc"\n---\nGuard.\n',
    });
    try {
      const warnings = await build(v);
      assert.equal(warnings.filter((w) => w.includes("foundry.base")).length, 0);
      const meta = await metaFor(v, "Guard.body.html");
      assert.deepEqual(meta?.foundry?.base, [
        "Compendium.dnd-monster-manual.actors.Actor.mmGuard000000000",
        "Compendium.dnd5e.actors24.Actor.mmGuard000000000",
        "Actor:npc",
      ]);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("warns when a list ends on a UUID, since it can still resolve to nothing", async () => {
    const v = await setupVault({
      "Guard.md": '---\nfoundry:\n  base:\n  - "Compendium.a.actors.Actor.aaaaaaaaaaaaaaaa"\n  - "Compendium.b.actors.Actor.bbbbbbbbbbbbbbbb"\n---\nGuard.\n',
    });
    try {
      const warnings = await build(v);
      assert.ok(warnings.find((w) => w.includes("can still resolve to nothing")));
      // Still forwarded — it's a caution, not a rejection.
      const meta = await metaFor(v, "Guard.body.html");
      assert.equal((meta?.foundry?.base as string[]).length, 2);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("says nothing when the foundry block has no base at all", async () => {
    const v = await setupVault({
      "Guard.md": "---\nfoundry:\n  embed: false\n---\nGuard.\n",
    });
    try {
      const warnings = await build(v);
      assert.equal(warnings.filter((w) => w.includes("foundry.base")).length, 0);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });
});
