// Tests for auto-discovery of a page's cover image (`auto_image`), which feeds
// OG/Twitter meta, Bases card covers, and an add-on's use of a page's art.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePageImage } from "../src/render/cover.js";
import { slugify } from "../src/render/slug.js";
import type { ImageEntry } from "../src/render/types.js";

function index(...files: string[]): Map<string, ImageEntry> {
  return new Map(
    files.map((f) => [slugify(f.split("/").pop()!), { sourcePath: f, outputPath: f }]),
  );
}

const images = index("attachments/real.webp");

describe("cover auto-discovery", () => {
  it("picks the first body embed", () => {
    assert.equal(resolvePageImage("![[real.webp]]", {}, images, true), "/attachments/real.webp");
  });

  it("prefers frontmatter over the body", () => {
    assert.equal(
      resolvePageImage("![[other.webp]]", { image: "real.webp" }, images, true),
      "/attachments/real.webp",
    );
  });

  it("ignores an embed inside an inline code span", () => {
    const source = "| `image` | Accepts a wikilink (`![[portrait.png]]`). |";
    assert.equal(resolvePageImage(source, {}, images, true), null);
  });

  it("ignores an embed inside a fenced block", () => {
    const source = "```markdown\n![[portrait.png]]\n```\n\ntext";
    assert.equal(resolvePageImage(source, {}, images, true), null);
  });

  it("still finds a real embed that follows a documenting fence", () => {
    const source = "```markdown\n![[portrait.png]]\n```\n\n![[real.webp]]";
    assert.equal(resolvePageImage(source, {}, images, true), "/attachments/real.webp");
  });

  it("returns null when auto-discovery is off", () => {
    assert.equal(resolvePageImage("![[real.webp]]", {}, images, false), null);
  });
});
