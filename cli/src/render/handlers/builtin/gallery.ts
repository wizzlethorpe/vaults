// Built-in `gallery` code-block handler.
//
// Renders a responsive grid of image thumbnails. Syntax: one image per line,
// referenced by name (Obsidian-basename style, like a `![[file]]` embed), with
// an optional caption after a pipe:
//
//   ```gallery
//   great-hall.webp | Great Hall
//   goblin-bank.webp | Goblin Bank
//   forest-river.webp
//   ```
//
// Lines beginning with `#` are comments. Images resolve through the same index
// as `![[ ]]` embeds, so a referenced file is staged into the deploy (the
// build's per-variant scanner reads `gallery` blocks for exactly this). Styles
// ship as a built-in asset concatenated into _handlers.css.

import type { CodeBlockHandler, HandlerContext } from "../types.js";
import { registerBuiltinAssets } from "../assets.js";
import { slugify } from "../../slug.js";

/** Vault-relative output path -> absolute, percent-encoded served URL. */
function servedSrc(path: string): string {
  return "/" + path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

/** Parse one `name | caption` line into its parts, or null to skip it. */
export function parseGalleryLine(line: string): { name: string; caption: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const sep = trimmed.indexOf("|");
  const name = (sep === -1 ? trimmed : trimmed.slice(0, sep)).trim();
  if (!name) return null;
  const caption = sep === -1 ? "" : trimmed.slice(sep + 1).trim();
  return { name, caption };
}

export const galleryHandler: CodeBlockHandler = {
  codeBlock: "gallery",
  render(content: string, ctx: HandlerContext): { html: string } {
    const items: string[] = [];
    for (const line of content.split("\n")) {
      const parsed = parseGalleryLine(line);
      if (!parsed) continue;
      const { name, caption } = parsed;
      // Resolve the file to its staged output path the same way `![[ ]]`
      // embeds do; fall back to the bare name so a typo still points somewhere.
      const entry = ctx.render.images.get(slugify(name.split("/").pop() ?? name));
      const src = ctx.escape(servedSrc(entry?.outputPath ?? name));
      const alt = ctx.escape(caption || name);
      const cap = caption
        ? `<span class="vaults-gallery-caption">${ctx.escape(caption)}</span>`
        : "";
      // The tile is a link to the full image: CSS crops the <img> to a uniform
      // grid cell, and the runtime opens the full image in a lightbox on click.
      // With JS off, the link still opens the full image directly.
      items.push(
        `<a class="vaults-gallery-item" href="${src}"><img src="${src}" alt="${alt}" loading="lazy">${cap}</a>`,
      );
    }
    if (items.length === 0) {
      return { html: `<div class="vaults-gallery-error">Empty gallery block.</div>` };
    }
    return { html: `<div class="vaults-gallery">${items.join("")}</div>` };
  },
};

const GALLERY_STYLES = `
.vaults-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: .6rem; margin: 1.25rem 0; }
.vaults-gallery-item { display: block; text-decoration: none; color: inherit; cursor: zoom-in; }
.vaults-gallery-item img { display: block; width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 8px; }
.vaults-gallery-caption { display: block; margin-top: .25rem; font-size: .8rem; text-align: center; opacity: .8; }
.vaults-gallery-error { padding: .5rem .75rem; border: 1px solid #b94a3a; border-radius: 4px; color: #b94a3a; font-size: .85rem; }
.vaults-lightbox { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(0,0,0,.85); cursor: zoom-out; }
.vaults-lightbox img { max-width: 100%; max-height: 100%; border-radius: 6px; box-shadow: 0 4px 30px rgba(0,0,0,.5); }
`;

// Click a tile -> open its full image in a lightbox overlay. Event-delegated so
// it covers every gallery on the page, and progressive: with JS disabled the
// tile's <a href> just opens the full image. Wrapped in an IIFE.
const GALLERY_RUNTIME = `
(function () {
  function open(src, alt) {
    var ov = document.createElement("div");
    ov.className = "vaults-lightbox";
    var img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    ov.appendChild(img);
    function close() { ov.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    ov.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a.vaults-gallery-item") : null;
    if (!a) return;
    e.preventDefault();
    var img = a.querySelector("img");
    open(a.getAttribute("href"), img ? img.getAttribute("alt") : "");
  });
})();
`;

registerBuiltinAssets(galleryHandler, {
  scripts: [{ source: "builtin/gallery.runtime.js", content: GALLERY_RUNTIME }],
  styles: [{ source: "builtin/gallery.css", content: GALLERY_STYLES }],
});
