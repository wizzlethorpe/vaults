// Normalise plain markdown image URLs (`![alt](path/to/foo.webp)`) to the
// absolute, slugified URL the build emits for that image. Without this the
// `<img src>` keeps the author's relative path verbatim — fine in a browser
// loading the page from `/Features/Images.html` (which resolves
// `../attachments/foo.webp` correctly), but broken anywhere else that loads
// the rendered HTML out of context: most notably the Foundry module's
// journal-page sheet, which runs from `/game` and ends up pointing at
// `/attachments/foo.webp` as if it lived at the world root.
//
// Wikilink-style image embeds (`![[foo.webp]]`) already resolve through the
// embed plugin, which writes the absolute URL directly. This plugin is the
// matching pass for the standard markdown form.
//
// External URLs (`https://`, `data:`) and references to images we didn't
// build are left untouched so the author can still link out or surface
// missing-image cases through the normal warning flow downstream.

import type { Plugin } from "unified";
import type { Root, Image } from "mdast";
import { visit } from "unist-util-visit";
import { slugify } from "./slug.js";
import { IMAGE_EXT_RE } from "./extensions.js";
import type { RenderContext } from "./types.js";

export function imageSrcsPlugin(opts: { context: RenderContext }): Plugin<[], Root> {
  const { context } = opts;
  return () => (tree) => {
    visit(tree, "image", (node: Image) => {
      const url = node.url;
      if (!url) return;
      if (/^(https?:|data:|blob:|mailto:|#)/i.test(url)) return;
      if (url.startsWith("/")) return;
      const basename = url.split("/").pop()!.split("#")[0]!.split("?")[0]!;
      if (!IMAGE_EXT_RE.test(basename)) return;
      const slug = slugify(decodeURIComponent(basename));
      const entry = context.images.get(slug);
      if (!entry) return;
      node.url = "/" + entry.outputPath.split("/").map(encodeURIComponent).join("/");
    });
  };
}
