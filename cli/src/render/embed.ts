import type { Plugin } from "unified";
import type { Root, Html } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { RenderContext } from "./types.js";
import { slugify } from "./slug.js";

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|tiff?)$/i;
// ![[image.png]] or ![[image.png|300]] or ![[image.png|300x200]]
const EMBED_RE = /!\[\[([^\[\]|#\n]+?)(?:\|([^\[\]#\n]*))?\]\]/g;

export function embedPlugin(opts: { context: RenderContext }): Plugin<[], Root> {
  return () => (tree) => {
    findAndReplace(tree, [
      [
        EMBED_RE,
        (_match: string, rawName: string, rawAlias?: string) => {
          const name = rawName.trim();
          const alias = rawAlias?.trim();
          if (!IMAGE_EXT_RE.test(name)) {
            // Non-image embeds (page transclusion etc.) aren't supported in v1.
            return { type: "text", value: `[${name}]` };
          }

          const slug = slugify(name);
          const image = opts.context.images.get(slug);
          const path = image?.outputPath ?? name;
          const src = "/" + path.split("/").map(encodeURIComponent).join("/");
          const sizeAttrs = parseSizeHint(alias);

          return {
            type: "html",
            value: `<img src="${escAttr(src)}" alt="${escAttr(name)}" loading="lazy"${sizeAttrs}>`,
          } satisfies Html;
        },
      ],
    ]);
  };
}

function parseSizeHint(alias: string | undefined): string {
  if (!alias) return "";
  const m = /^(\d+)(?:x(\d+))?$/.exec(alias);
  if (!m) return "";
  return m[2] != null ? ` width="${m[1]}" height="${m[2]}"` : ` width="${m[1]}"`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
