import { slugify } from "./slug.js";
import type { ImageEntry } from "./types.js";

// Matches the first image embed in a markdown body, in either Obsidian
// (`![[name.ext]]`) or standard (`![alt](path/name.ext)`) form. Anchored to
// any image extension we ship so we don't grab `![[Page]]` text transclusions.
const IMAGE_EXT = "png|jpe?g|webp|gif|svg|avif|tiff?";
const FIRST_IMAGE_RE = new RegExp(
  `!\\[\\[([^\\[\\]\\n|#]+\\.(?:${IMAGE_EXT}))(?:\\|[^\\]]*)?\\]\\]|!\\[[^\\]]*\\]\\(([^)\\s]+\\.(?:${IMAGE_EXT}))(?:\\s+[^)]*)?\\)`,
  "i",
);

/**
 * Resolve a page's representative image to its served URL. Used for OG/Twitter
 * meta tags, Bases card covers, and the Foundry reskin pipeline.
 *
 * Resolution order:
 *   1. `image:` frontmatter (string; `![[foo.webp]]` wikilink form is unwrapped).
 *   2. If `autoImage` is true, the first image embed in the body.
 * Returns the absolute, post-compression URL (e.g. "/attachments/foo.webp"),
 * or null when nothing matches. External URLs pass through unchanged.
 */
export function resolvePageImage(
  source: string,
  frontmatter: Record<string, unknown> | undefined,
  images: Map<string, ImageEntry>,
  autoImage: boolean,
): string | null {
  let raw: string | null = null;

  const fmImage = frontmatter?.["image"];
  if (typeof fmImage === "string" && fmImage.length > 0) {
    raw = fmImage;
  } else if (autoImage) {
    const m = FIRST_IMAGE_RE.exec(source);
    if (m) raw = m[1] ?? m[2] ?? null;
  }
  if (!raw) return null;

  raw = raw.replace(/^!\[\[/, "").replace(/\]\]$/, "").split("|")[0]!.trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  const basename = raw.split("/").pop() || raw;
  const image = images.get(slugify(basename));
  if (image) return "/" + image.outputPath.split("/").map(encodeURIComponent).join("/");

  // Already a vault-relative path that wasn't compressed (rare: SVG, or
  // `image: attachments/foo.svg`); serve as-is.
  return "/" + raw.split("/").map(encodeURIComponent).join("/");
}
