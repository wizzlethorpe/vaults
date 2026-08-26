// Regression tests for duplicate asset filenames.
//
// Obsidian resolves `![[map.png]]` by basename, so two files with that name
// in different folders compete for one index key. The key used to be written
// from inside the concurrent staging pass, so whichever finished second won
// — and that varied between runs on identical input. A page could silently
// get a different image build to build, with nothing reported.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

async function buildVault(files: Record<string, string>): Promise<{ out: string; dir: string; warnings: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "vault-collide-"));
  const out = join(dir, "_out");
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
    await buildSite({ vaultPath: dir, outputDir: out });
  } finally {
    console.log = origLog; console.warn = origWarn;
  }
  return { out, dir, warnings };
}

const COLLIDING = {
  "index.md": "---\ntitle: Home\n---\n\n![[map.png]]\n",
  "Alpha/map.png": "ALPHA BYTES",
  "Zulu/map.png": "ZULU BYTES",
};

describe("duplicate asset filenames", () => {
  it("resolves to the same file on every build", async () => {
    // The actual defect was nondeterminism, so build the identical vault
    // repeatedly and require one answer.
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { out, dir } = await buildVault(COLLIDING);
      const html = await readFile(join(out, "index.body.html"), "utf8");
      seen.add(/src="([^"]*map[^"]*)"/.exec(html)?.[1] ?? "none");
      await rm(dir, { recursive: true, force: true });
    }
    assert.equal(seen.size, 1, `bare reference resolved inconsistently: ${[...seen].join(", ")}`);
  });

  it("gives the win to the first in sorted vault order", async () => {
    const { out, dir } = await buildVault(COLLIDING);
    try {
      const html = await readFile(join(out, "index.body.html"), "utf8");
      assert.match(html, /Alpha\/map/, "sorted order puts Alpha before Zulu");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("names both files in the warning so the author can disambiguate", async () => {
    const { dir, warnings } = await buildVault(COLLIDING);
    try {
      const hit = warnings.find((w) => w.includes("collision"));
      assert.ok(hit, `expected a collision warning, got: ${JSON.stringify(warnings)}`);
      assert.match(hit, /Alpha\/map\.png/);
      assert.match(hit, /Zulu\/map\.png/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("says nothing when filenames are unique", async () => {
    const { dir, warnings } = await buildVault({
      "index.md": "---\ntitle: Home\n---\n\n![[a.png]]\n![[b.png]]\n",
      "Alpha/a.png": "A", "Zulu/b.png": "B",
    });
    try {
      assert.equal(warnings.filter((w) => w.includes("collision")).length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still reaches the loser through its folder path", async () => {
    const { out, dir } = await buildVault({
      ...COLLIDING,
      "index.md": "---\ntitle: Home\n---\n\n![[Zulu/map.png]]\n",
    });
    try {
      const html = await readFile(join(out, "index.body.html"), "utf8");
      assert.match(html, /Zulu\/map/, "an explicit folder path must win over the basename");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
