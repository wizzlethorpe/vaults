// Tag every external `[label](https://…)` markdown link with
// `target="_blank"` + `rel="noopener noreferrer"` so a click opens in a
// new tab instead of dropping the reader off the wiki. Internal wikilinks
// (handled by wikilinkPlugin) and relative URLs stay in-tab.
//
// Convention: ANY absolute http(s) URL counts as external — even if it
// points at the same hostname. Authors who want an in-tab cross-link
// should use a vault-relative path / wikilink, not the absolute URL.

import type { Plugin } from "unified";
import type { Root, Link } from "mdast";
import { visit } from "unist-util-visit";

const EXTERNAL_RE = /^https?:\/\//i;

export function externalLinksPlugin(): Plugin<[], Root> {
  return () => (tree) => {
    visit(tree, "link", (node: Link) => {
      const url = node.url;
      if (!url || !EXTERNAL_RE.test(url)) return;
      // remark/mdast preserves arbitrary HAST props via `data.hProperties`,
      // which remark-rehype copies onto the resulting <a>. Merge so we
      // don't clobber anything an upstream pass might have set.
      const existing = node.data?.hProperties ?? {};
      node.data = {
        ...node.data,
        hProperties: {
          ...existing,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      };
    });
  };
}
