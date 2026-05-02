import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import matter from "gray-matter";
import type { RenderContext, RenderWarning } from "./types.js";
import { wikiLinkPlugin } from "./wikilink.js";
import { embedPlugin } from "./embed.js";
import { calloutPlugin } from "./callouts.js";

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: "",
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    img: ["src", "alt", "width", "height", "loading"],
    a: ["href", "title", "className", "id"],
    div: ["className", "data*"],
  },
};

export interface RenderResult {
  html: string;
  title: string;
  frontmatter: Record<string, unknown>;
  /** Resolved outbound link target paths. */
  outlinks: string[];
  /** Broken wikilinks, missing images, missing transclusions encountered while rendering. */
  warnings: RenderWarning[];
}

export async function renderMarkdown(
  source: string,
  context: RenderContext,
  fallbackTitle: string,
): Promise<RenderResult> {
  const parsed = matter(source);
  const fm = parsed.data as Record<string, unknown>;
  const outlinks: string[] = [];
  const warnings: RenderWarning[] = [];

  // Pre-process the markdown source before parsing.
  //   1. Strip Obsidian-style comments (%% ... %% — single- or multi-line).
  //   2. Escape pipes inside wikilinks/embeds so they don't break GFM tables.
  //      CommonMark unescapes `\|` back to `|` in the resulting text node, so
  //      the wikilink regex still matches downstream. Negative lookbehind
  //      avoids double-escaping pipes the user already escaped Obsidian-style.
  const content = parsed.content
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/!?\[\[([^\[\]\n]+?)\]\]/g, (m) => m.replace(/(?<!\\)\|/g, "\\|"));

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(calloutPlugin({ redactRoles: context.redactRoles }))
    .use(embedPlugin({ context, warnings }))
    .use(wikiLinkPlugin({ context, outlinks, warnings }))
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(content);

  const title = (typeof fm.title === "string" && fm.title)
    || extractH1(parsed.content)
    || fallbackTitle;

  return { html: String(file), title, frontmatter: fm, outlinks, warnings };
}

function extractH1(markdown: string): string | null {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1]!.trim() : null;
}
