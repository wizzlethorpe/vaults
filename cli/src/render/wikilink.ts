import type { Plugin } from "unified";
import type { Root, Link, Text } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { RenderContext } from "./types.js";
import { slugify } from "./slug.js";

// Matches [[Page]], [[Page|alias]], [[Page#anchor]], [[Page#anchor|alias]].
// Negative lookbehind blocks ![[embed]] from being consumed here.
const WIKILINK_RE = /(?<!!)(?<!\[)\[\[([^\[\]|#\n]+?)(?:#([^\[\]|#\n]+?))?(?:\|([^\[\]#\n]+?))?\]\]/g;

export function wikiLinkPlugin(opts: { context: RenderContext }): Plugin<[], Root> {
  return () => (tree) => {
    findAndReplace(tree, [
      [
        WIKILINK_RE,
        (_match: string, rawName: string, rawAnchor?: string, rawAlias?: string) => {
          const name = rawName.trim();
          const anchor = rawAnchor?.trim();
          const display = rawAlias?.trim() ?? name;
          const slug = slugify(name);

          const page = opts.context.pages.get(slug);
          const href = page != null
            ? "/" + page.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/") + (anchor ? `#${anchor}` : "")
            : "#";

          // Match forgotten-folk's class scheme: `internal` for resolved, `internal new` for unresolved.
          const className = page != null ? ["internal"] : ["internal", "new"];

          const node: Link = {
            type: "link",
            url: href,
            children: [{ type: "text", value: display } satisfies Text],
            data: { hProperties: { className } },
          };
          return node;
        },
      ],
    ]);
  };
}
