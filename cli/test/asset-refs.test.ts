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

describe("images a code-block handler names", () => {
  const HANDLER = `export const handler = {
  codeBlock: "layers",
  imagePaths: (content) => content.split("\\n").filter(Boolean),
  render: () => ({ html: "<div></div>" }),
};
`;
  const block = (lang: string, image: string) => `\`\`\`${lang}\n${image}\n\`\`\`\n`;
  const vault = (page: string, extra: Record<string, string> = {}) => ({
    ".vaults/handlers/layers.mjs": HANDLER,
    "Map.md": `# Map\n\n${page}`,
    "art/a.png": "PNG", "art/b.png": "PNG", "art/c.png": "PNG",
    ...extra,
  });

  it("ship with the page, by full vault path, though nothing else refers to them", async () => {
    const { out, dir } = await buildVault(vault(`${block("layers", "art/a.png")}\nart/b.png in prose\n\n${block("layers", "art/c.png")}`));
    try {
      assert.equal(await shipped(out, "art/a.png"), true);
      assert.equal(await shipped(out, "art/c.png"), true, "a second block on the page");
      assert.equal(await shipped(out, "art/b.png"), false, "named between the blocks, by no handler");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("are read from the blocks the renderer hands the handler, wherever they sit", async () => {
    const { out, dir } = await buildVault(vault(
      `- item\n\n  ~~~layers\n  art/a.png\n  ~~~\n\n${block("layers2", "art/b.png")}\n> [!note]\n> \`\`\`layers\n> art/c.png\n> \`\`\`\n`,
    ));
    try {
      assert.equal(await shipped(out, "art/a.png"), true, "a tilde fence inside a list item");
      assert.equal(await shipped(out, "art/b.png"), false, "another language");
      assert.equal(await shipped(out, "art/c.png"), true, "inside a callout every reader sees");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("count when the block was emitted by another handler", async () => {
    const WRAP = `export const handler = {
  codeBlock: "wrap",
  render: (content) => ({ markdown: "\\\`\\\`\\\`layers\\n" + content + "\\n\\\`\\\`\\\`\\n" }),
};
`;
    const { out, dir } = await buildVault(vault(block("wrap", "art/a.png"), { ".vaults/handlers/wrap.mjs": WRAP }));
    try {
      assert.equal(await shipped(out, "art/a.png"), true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("stay out of a variant whose reader cannot see the block", async () => {
    const { out, dir } = await buildVault(vault(
      `> [!dm]\n> \`\`\`layers\n> art/a.png\n> \`\`\`\n\n> [!note]\n> > [!dm]\n> > \`\`\`layers\n> > art/b.png\n> > \`\`\`\n`,
      { ".vaultrc.json": JSON.stringify({ roles: ["public", "dm"], rolePasswords: { dm: "100000:0000:0000" } }) },
    ));
    try {
      assert.equal(await shipped(out, "_variants/dm/art/a.png"), true);
      assert.equal(await shipped(out, "_variants/public/art/a.png"), false);
      assert.equal(await shipped(out, "_variants/dm/art/b.png"), true);
      assert.equal(await shipped(out, "_variants/public/art/b.png"), false, "gated inside a callout the public does see");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
