// Regression tests for the auto-generated folder index pages (buildSite
// synthesizes an index.md per folder with a Bases table of its children).
// A folder name containing an apostrophe used to terminate the YAML
// single-quoted filter scalar, so yaml.load threw and the index rendered
// a bases-error block instead of the table.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; out: string; }

async function setup(files: Record<string, string>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-folder-index-"));
  const out = join(dir, "_out");
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
    await buildSite({
      vaultPath: v.dir,
      outputDir: v.out,
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

const VAULTRC = JSON.stringify({ roles: ["public"], rolePasswords: {} });

describe("folder index: apostrophe in folder name", () => {
  it("renders the Bases table (not an error block) for a folder with an apostrophe", async () => {
    const v = await setup({
      ".vaultrc.json": VAULTRC,
      "Ander's Keep/Guard Captain.md": "# Guard Captain\nWatch commander.",
      "Ander's Keep/Tavern.md": "# The Tavern\nAle and rumors.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Ander's Keep/index.html"), "utf8");
      assert.doesNotMatch(html, /bases-error/, "folder index rendered a base error block");
      assert.match(html, /<table/, "folder index did not render a Bases table");
      assert.match(html, /Guard Captain/);
      assert.match(html, /The Tavern/);
    } finally {
      await rm(v.dir, { recursive: true, force: true });
    }
  });
});
