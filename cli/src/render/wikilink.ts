import type { Plugin } from "unified";
import type { Root, Link, Text } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { RenderContext, RenderWarning } from "./types.js";
import { slugify } from "./slug.js";

// Matches [[Page]], [[Page|alias]], [[Page#anchor]], [[Page#anchor|alias]].
// Negative lookbehind blocks ![[embed]] from being consumed here.
const WIKILINK_RE = /(?<!!)(?<!\[)\[\[([^\[\]|#\n]+?)(?:#([^\[\]|#\n]+?))?(?:\|([^\[\]#\n]+?))?\]\]/g;

export function wikiLinkPlugin(opts: {
  context: RenderContext;
  /** Receives each resolved target page's vault path; used to compute backlinks. */
  outlinks?: string[];
  /** Receives one warning per unresolved [[wikilink]]. */
  warnings?: RenderWarning[];
}): Plugin<[], Root> {
  return () => (tree) => {
    findAndReplace(tree, [
      [
        WIKILINK_RE,
        (_match: string, rawName: string, rawAnchor?: string, rawAlias?: string) => {
          const name = rawName.trim();
          const anchor = rawAnchor?.trim();
          const display = rawAlias?.trim() ?? name;
          const slug = slugify(name);

          // Resolution order:
          //   1. Slug of the full input (matches basename slugs and aliases)
          //   2. Full-path slug (e.g. [[NPCs/Aldric]])
          //   3. `<slug>/index` (so a bare [[NPCs]] picks up the auto-
          //      generated folder index)
          //   4. Last path segment slug (so [[Scenarios/The Open Door]]
          //      still resolves when the file actually lives elsewhere
          //      under that basename — Obsidian treats the slash form as
          //      a path; we're more lenient).
          const lastSegment = name.includes("/") ? name.split("/").pop()! : "";
          const page = opts.context.pages.get(slug)
            ?? opts.context.pages.get(slugify(name.replace(/\.md$/i, "").replace(/\//g, "/")))
            ?? opts.context.pages.get(slugify(name + "/index"))
            ?? (lastSegment ? opts.context.pages.get(slugify(lastSegment)) : undefined);
          const href = page != null
            ? "/" + page.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/") + (anchor ? `#${anchor}` : "")
            : "#";

          if (page && opts.outlinks) opts.outlinks.push(page.path);
          if (!page && opts.warnings) opts.warnings.push({ kind: "broken-link", target: name });

          // Mirror Obsidian's DOM: `internal-link` is the canonical class community
          // snippets target. We also keep `internal` (and `new` for unresolved) for
          // our default CSS.
          const className = page != null
            ? ["internal", "internal-link"]
            : ["internal", "internal-link", "is-unresolved", "new"];

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
