// Tests for the built-in `gallery` code-block handler: its render output and
// the build-side staging that ships the images it references into each variant.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { galleryHandler } from "../src/render/handlers/builtin/gallery.js";
import { slugify } from "../src/render/slug.js";
import { buildSite } from "../src/build.js";

function render(content: string, files: string[] = []): string {
  const images = new Map(
    files.map((f) => [slugify(f), { sourcePath: f, outputPath: f }]),
  );
  const ctx = {
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
    render: { images },
  } as never;
  return (galleryHandler.render(content, ctx) as { html: string }).html;
}

describe("gallery handler", () => {
  it("renders one item per line, wrapped in a gallery grid", () => {
    const html = render("a.webp\nb.webp\nc.webp", ["a.webp", "b.webp", "c.webp"]);
    assert.ok(html.startsWith('<div class="vaults-gallery">'));
    assert.equal((html.match(/class="vaults-gallery-item"/g) ?? []).length, 3);
  });

  it("resolves a referenced image to its staged output path", () => {
    const html = render("maps/keep.webp", ["maps/keep.webp"]);
    assert.ok(html.includes('src="/maps/keep.webp"'));
  });

  it("links each tile to the full image (for click-to-view / lightbox)", () => {
    const html = render("maps/keep.webp", ["maps/keep.webp"]);
    assert.ok(html.includes('<a class="vaults-gallery-item" href="/maps/keep.webp">'));
  });

  it("renders a caption after the pipe and uses it as alt text", () => {
    const html = render("a.webp | The Great Hall", ["a.webp"]);
    assert.ok(html.includes('<span class="vaults-gallery-caption">The Great Hall</span>'));
    assert.ok(html.includes('alt="The Great Hall"'));
  });

  it("skips blank lines and # comments", () => {
    const html = render("# heading\n\na.webp\n\n# note\nb.webp", ["a.webp", "b.webp"]);
    assert.equal((html.match(/class="vaults-gallery-item"/g) ?? []).length, 2);
  });

  it("falls back to the bare name when the image is not in the index", () => {
    const html = render("missing.webp", []);
    assert.ok(html.includes('src="/missing.webp"'));
  });

  it("emits an error box for an empty block", () => {
    assert.ok(render("\n  \n").includes("vaults-gallery-error"));
  });
});

describe("gallery image staging", () => {
  it("ships an image referenced only inside a ```gallery block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-gal-"));
    const out = join(dir, "_out");
    const files: Record<string, string> = {
      ".vaultrc.json": JSON.stringify({ roles: ["public"], rolePasswords: {} }),
      "index.md": "---\ntitle: Home\n---\n# Home\n\n```gallery\nattachments/map.webp | A Map\n```\n",
      // 1x1 webp is not needed; the staging path copies whatever bytes exist.
      "attachments/map.webp": "FAKE WEBP BYTES",
    };
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
    }
    const origLog = console.log, origWarn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try {
      await buildSite({ vaultPath: dir, outputDir: out, vaultName: "T", imageQuality: 0, maxFileBytes: 1 << 30 });
      const exists = await stat(join(out, "attachments/map.webp")).then(() => true, () => false);
      assert.equal(exists, true, "gallery-referenced image must ship to the deploy");
    } finally {
      console.log = origLog; console.warn = origWarn;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
