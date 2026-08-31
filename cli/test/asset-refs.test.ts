// Which embed spellings actually stage an asset.
//
// The renderer and the asset collector read the same embed independently, so
// a spelling one accepts and the other does not fails silently: the page shows
// an <img>, the file never ships, and the only symptom is a 404 at the reader.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

async function buildVault(files: Record<string, string>): Promise<{ out: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "vault-refs-"));
  const out = join(dir, "_out");
  const all = { "settings.md": "---\nimage_quality: 0\n---\n", ...files };
  for (const [path, content] of Object.entries(all)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try {
    await buildSite({ vaultPath: dir, outputDir: out });
  } finally {
    console.log = origLog; console.warn = origWarn;
  }
  return { out, dir };
}

const shipped = async (out: string, path: string): Promise<boolean> => {
  try { await access(join(out, path)); return true; } catch { return false; }
};

describe("embedded image staging", () => {
  it("ships an image whose only embed is in a table cell", async () => {
    // A table cell has to escape the size hint's pipe or it reads as a column
    // break. That backslash used to land inside the captured filename, so the
    // image rendered and then 404'd.
    const { out, dir } = await buildVault({
      "index.md": "---\ntitle: Home\n---\n\n| Art | Name |\n| --- | --- |\n| ![[art.webp\\|90]] | Rotting Eye |\n",
      "attachments/art.webp": "BYTES",
    });
    try {
      const html = await readFile(join(out, "index.body.html"), "utf8");
      assert.match(html, /<img[^>]*art/, "the renderer should emit the image");
      assert.ok(await shipped(out, "attachments/art.webp"), "and the file should ship beside it");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("still ships the unescaped spellings", async () => {
    const { out, dir } = await buildVault({
      "index.md": "---\ntitle: Home\n---\n\n![[sized.webp|90]]\n\n![[plain.webp]]\n",
      "attachments/sized.webp": "BYTES",
      "attachments/plain.webp": "BYTES",
    });
    try {
      assert.ok(await shipped(out, "attachments/sized.webp"), "sized embed");
      assert.ok(await shipped(out, "attachments/plain.webp"), "bare embed");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
