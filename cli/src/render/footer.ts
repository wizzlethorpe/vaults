// One-shot markdown renderer for the page footer.
//
// The footer setting is rendered ONCE per build (not per page) into a
// short HTML string, which is then embedded verbatim in every page's
// layout. Supports inline markdown (links, bold, italic) via the same
// remark/rehype stack the page renderer uses, so the output looks like
// any other rendered markdown.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

/**
 * Render a one-line markdown string to inline HTML. The remark pipeline
 * always wraps single-paragraph input in `<p>…</p>`; we strip that wrapper
 * so the result drops cleanly into a `<footer>` element.
 *
 * Returns an empty string for empty input so callers can branch on truthy.
 */
export async function renderFooterHtml(markdown: string): Promise<string> {
  const trimmed = markdown.trim();
  if (!trimmed) return "";
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(trimmed);
  const html = String(file).trim();
  return html.startsWith("<p>") && html.endsWith("</p>")
    ? html.slice(3, -4)
    : html;
}
