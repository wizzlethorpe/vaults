import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeStringify from "rehype-stringify";
import matter from "gray-matter";
import type { RenderContext } from "./types.js";
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
  /** Raw outbound link slugs (resolved or not). */
  outlinks: string[];
}

export async function renderMarkdown(
  source: string,
  context: RenderContext,
  fallbackTitle: string,
): Promise<RenderResult> {
  const parsed = matter(source);
  const fm = parsed.data as Record<string, unknown>;

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(calloutPlugin())
    .use(embedPlugin({ context }))
    .use(wikiLinkPlugin({ context }))
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: "wrap" })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(parsed.content);

  const title = (typeof fm.title === "string" && fm.title)
    || extractH1(parsed.content)
    || fallbackTitle;

  return { html: String(file), title, frontmatter: fm, outlinks: [] };
}

function extractH1(markdown: string): string | null {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1]!.trim() : null;
}
