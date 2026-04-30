import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, Text } from "mdast";
import { visit } from "unist-util-visit";

// Obsidian-style callouts: blockquote starting with `[!type]` becomes a styled div.
//
//   > [!note] Optional title
//   > Body content
//
//   > [!dm]
//   > DM-only block
//
// Recognised types map to CSS classes via .callout.callout-<type>.

const CALLOUT_RE = /^\[!(\w+)\][+-]?\s*(.*?)(?:\n|$)/;

export function calloutPlugin(): Plugin<[], Root> {
  return () => (tree) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      if (!first || first.type !== "paragraph") return;
      const firstChild = (first as Paragraph).children[0];
      if (!firstChild || firstChild.type !== "text") return;

      const match = CALLOUT_RE.exec((firstChild as Text).value);
      if (!match) return;

      const [fullMatch, type, rawTitle] = match;
      const title = (rawTitle ?? "").trim() || cap(type!);

      const remaining = (firstChild as Text).value.slice(fullMatch.length);
      if (remaining.trim()) {
        (firstChild as Text).value = remaining.replace(/^\n+/, "");
      } else {
        (first as Paragraph).children.shift();
        if ((first as Paragraph).children.length === 0) node.children.shift();
      }

      // Both className and data-callout are emitted: our default CSS keys off
      // the class, while Obsidian-style snippets target [data-callout="…"].
      const lower = type!.toLowerCase();
      node.data = {
        hName: "div",
        hProperties: {
          className: ["callout", `callout-${lower}`],
          dataCallout: lower,
        },
      };

      node.children.unshift({
        type: "paragraph",
        data: { hName: "div", hProperties: { className: ["callout-title"] } },
        children: [{ type: "text", value: title }],
      } satisfies Paragraph);
    });
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
