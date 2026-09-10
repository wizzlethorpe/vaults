// `folder_notes: true` adopts Obsidian's convention that a note named after
// its folder is that folder's page: 'Places/Places.md' is built as
// 'Places/index.md' and replaces the index the build would generate there.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";
import { writeSettingsFile } from "./settings-helpers.js";

interface Vault { dir: string; out: string; }

async function setup(files: Record<string, string>, settings = ""): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-folder-notes-"));
  const out = join(dir, "_out");
  await writeSettingsFile(dir, settings);
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
    await buildSite({ vaultPath: v.dir, outputDir: v.out });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const VAULTRC = JSON.stringify({ roles: ["public"], rolePasswords: {} });
const ON = "folder_notes: true\n";

describe("folder notes", () => {
  it("builds a note named after its folder as that folder's index", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/Places.md": "Ports, roads and the places between.",
      "Places/Harbor.md": "# Harbor\nDeep water.",
    }, ON);
    try {
      await build(v);
      const html = await readFile(join(v.out, "Places/index.html"), "utf8");
      assert.match(html, /Ports, roads and the places between/,
        "folder index served the generated listing instead of the folder note");
      assert.equal(await exists(join(v.out, "Places/Places.html")), false,
        "folder note was also built at its own URL");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("titles the folder note after its folder, not 'index'", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/Places.md": "Ports, roads and the places between.",
      "Places/Harbor.md": "# Harbor\nDeep water.",
    }, ON);
    try {
      await build(v);
      const html = await readFile(join(v.out, "Places/index.html"), "utf8");
      assert.match(html, /<h1[^>]*>Places</, "folder note did not take its folder's name as its title");
      assert.doesNotMatch(html, /<h1[^>]*>index</i);
      const search = JSON.parse(await readFile(join(v.out, "_search-index.json"), "utf8")) as
        Array<{ title: string; path: string }>;
      const entry = search.find((e) => e.path === "Places/index.md");
      assert.equal(entry?.title, "Places", "folder note is titled 'index' in the search index");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("resolves a bare [[Folder]] wikilink to the folder note", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/Places.md": "Ports, roads and the places between.",
      "Guide.md": "# Guide\nStart at [[Places]].",
    }, ON);
    try {
      await build(v);
      const html = await readFile(join(v.out, "Guide.html"), "utf8");
      assert.match(html, /href="\/Places\/index"/, "[[Places]] did not point at the folder note");
      assert.doesNotMatch(html, /is-unresolved/, "[[Places]] rendered as a broken link");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("leaves the note alone when the setting is off", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/Places.md": "Ports, roads and the places between.",
      "Places/Harbor.md": "# Harbor\nDeep water.",
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, "Places/Places.html")), true,
        "folder note stopped being its own page without folder_notes set");
      const html = await readFile(join(v.out, "Places/index.html"), "utf8");
      assert.doesNotMatch(html, /Ports, roads and the places between/,
        "generated folder index was replaced by the folder note");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("resolves an explicit [[Folder/Folder]] path, which Obsidian writes when a basename is ambiguous", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/Places.md": "Ports, roads and the places between.",
      "Guide.md": "# Guide\nStart at [[Places/Places]].",
    }, ON);
    try {
      await build(v);
      const html = await readFile(join(v.out, "Guide.html"), "utf8");
      assert.doesNotMatch(html, /is-unresolved/, "[[Places/Places]] rendered as a broken link");
      assert.match(html, /href="\/Places\/index"/);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("transcludes the folder note through ![[Folder]]", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/Places.md": "Ports, roads and the places between.",
      "Guide.md": "# Guide\n\n![[Places]]\n",
    }, ON);
    try {
      await build(v);
      const html = await readFile(join(v.out, "Guide.html"), "utf8");
      assert.doesNotMatch(html, /embed-broken/, "![[Places]] rendered as a broken embed");
      assert.match(html, /Ports, roads and the places between/,
        "the folder note's body was not inlined");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("makes a note named after the vault the homepage", async () => {
    // The vault's own directory name is not part of a vault-relative path, so
    // the root note has no parent folder to be compared against.
    const dir = await mkdtemp(join(tmpdir(), "Harbortown-"));
    const vaultName = dir.split("/").pop()!;
    const v: Vault = { dir, out: join(dir, "_out") };
    await writeSettingsFile(dir, ON);
    await writeFile(join(dir, ".vaults/config.json"), VAULTRC);
    await writeFile(join(dir, `${vaultName}.md`), "The whole sorry business.");
    try {
      await build(v);
      const html = await readFile(join(v.out, "index.html"), "utf8");
      assert.match(html, /The whole sorry business/,
        "the root note was not built as the vault's homepage");
      assert.match(html, new RegExp(`<h1[^>]*>${vaultName}<`),
        "the homepage was titled 'Home' rather than after the note on disk");
      assert.equal(await exists(join(v.out, `${vaultName}.html`)), false,
        "the root note was also built at its own URL");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not treat two index pages as one when the case differs", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/INDEX.md": "# Places\nThe index that was already here.",
      "Places/Places.md": "Ports, roads and the places between.",
    }, ON);
    try {
      await build(v);
      assert.equal(await exists(join(v.out, "Places/Places.html")), true,
        "the folder note was renamed on top of a differently-cased index");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("matches default_frontmatter globs against the name on disk", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/Places.md": "Ports, roads and the places between.",
    }, `${ON}default_frontmatter:\n  - match: 'Places/Places.md'\n    data:\n      title: From the rule\n`);
    try {
      await build(v);
      const html = await readFile(join(v.out, "Places/index.html"), "utf8");
      assert.match(html, /<h1[^>]*>From the rule</,
        "a rule naming the file on disk stopped matching once it was renamed");
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });

  it("keeps a hand-written index.md and leaves the folder note a normal page", async () => {
    const v = await setup({
      ".vaults/config.json": VAULTRC,
      "Places/index.md": "# Places\nThe index that was already here.",
      "Places/Places.md": "Ports, roads and the places between.",
    }, ON);
    try {
      await build(v);
      const index = await readFile(join(v.out, "Places/index.html"), "utf8");
      assert.match(index, /The index that was already here/, "folder note overwrote an existing index.md");
      const note = await readFile(join(v.out, "Places/Places.html"), "utf8");
      assert.match(note, /Ports, roads and the places between/);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });
});
