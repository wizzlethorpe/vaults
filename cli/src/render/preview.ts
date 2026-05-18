import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { slugify } from "./slug.js";
import { stripFrontmatter } from "./frontmatter.js";
import { handlersPlugin } from "./handlers/dispatch.js";
import type { HandlerRegistry } from "./handlers/types.js";
import type { RenderContext } from "./types.js";
import { htmlEscape } from "../escape.js";

// Builds compact JSON preview blobs at build time for hover popovers.
// One file per page, served alongside the rendered .html as `<path>.preview.json`.
//
// Summaries are rendered to sanitised HTML (a few paragraphs at most) so the
// popover shows formatted content rather than stripped plain text.

export interface PagePreview {
  title: string;
  /** Rendered HTML; already sanitised. Safe to insert via innerHTML. */
  summary: string;
  /** anchor → { title, summary HTML } for [[Page#section]] hovers. */
  headings: Record<string, { title: string; summary: string }>;
}

/**
 * Context needed to resolve inline / code-block handlers (`fm:`, `dice:`, …)
 * inside preview snippets. Omit to skip handler dispatch entirely — the
 * preview then falls through with handler syntax preserved as literal text.
 * Pass all four together; partial context can't satisfy HandlerContext.
 */
export interface PreviewOptions {
  frontmatter: Record<string, unknown>;
  registry: HandlerRegistry;
  renderContext: RenderContext;
  /** Vault-relative path of the page (for handlers that emit page-relative URLs). */
  pagePath: string;
}

const SUMMARY_CHARS = 320;

// Span/code className survive sanitisation so handler output like
// <span class="fm-value">…</span> keeps its styling hook in the popover.
const previewSanitizeSchema = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter((t) => !["img", "iframe", "video"].includes(t)),
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    code: ["className", "title"],
  },
};

// handlersPlugin needs a HandlerContext; an empty no-op plugin keeps the
// pipeline shape identical when no handler context is supplied so we don't
// have to fork the chain type.
const noopRemarkPlugin = () => () => {};

function buildPipeline(opts?: PreviewOptions) {
  // allowDangerousHtml + rehypeRaw are needed so HTML emitted by handlers
  // (e.g. fm's <span>) survives into the rendered output instead of being
  // dropped as raw nodes at the markdown→hast boundary.
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(opts ? handlersPlugin({
      registry: opts.registry,
      context: {
        pagePath: opts.pagePath,
        frontmatter: opts.frontmatter,
        render: opts.renderContext,
        escape: htmlEscape,
      },
    }) : noopRemarkPlugin)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, previewSanitizeSchema)
    .use(rehypeStringify);
}

export async function buildPreview(rawMarkdown: string, title: string, opts?: PreviewOptions): Promise<PagePreview> {
  // Strip frontmatter, Obsidian %% comments %%, and fenced code blocks
  // before walking the body. Code fences render as a wall of source text
  // in a tiny hover popover, which looks worse than just omitting them —
  // same rationale as the table skip in truncateMarkdown.
  const body = stripFrontmatter(rawMarkdown)
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/^```[\s\S]*?^```[^\n]*$/gm, "")
    .replace(/^~~~[\s\S]*?^~~~[^\n]*$/gm, "")
    .trim();
  const pipeline = buildPipeline(opts);
  const summary = await renderSnippet(body, pipeline);

  const headings: Record<string, { title: string; summary: string }> = {};
  // Match headings even when nested inside a callout/blockquote.
  const sectionRe = /^(?:>\s*)?(#{1,6})\s+(.+)$/gm;
  const matches = [...body.matchAll(sectionRe)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const headingTitle = m[2]!.trim();
    const start = (m.index ?? 0) + m[0]!.length;
    const next = matches[i + 1];
    const end = next ? next.index ?? body.length : body.length;
    const sectionBody = body.slice(start, end);
    const anchor = slugify(headingTitle);
    headings[anchor] = {
      title: headingTitle,
      summary: await renderSnippet(sectionBody, pipeline),
    };
  }
  return { title, summary, headings };
}

/**
 * Truncate the markdown to the first ~SUMMARY_CHARS of body content (skipping
 * headings, image embeds, tables) and render it to sanitised HTML.
 */
async function renderSnippet(source: string, pipeline: ReturnType<typeof buildPipeline>): Promise<string> {
  const truncated = truncateMarkdown(source.trim(), SUMMARY_CHARS);
  if (!truncated) return "";
  const file = await pipeline.process(truncated);
  return String(file).trim();
}

function truncateMarkdown(source: string, maxChars: number): string {
  const paragraphs = source.split(/\n\s*\n/);
  const out: string[] = [];
  let total = 0;
  for (const raw of paragraphs) {
    let p = raw.trim()
      .replace(/^>\s?/gm, "")                       // strip blockquote markers
      .replace(/^\[!\w+\][+-]?[^\n]*\n?/, "")        // strip leading [!type] callout marker
      .split("\n").filter((line) => !/^#{1,6}\s/.test(line)).join("\n")  // drop heading lines
      .trim();
    if (!p) continue;
    if (/^!\[\[/.test(p)) continue;                  // skip image embeds
    if (/^\|/.test(p)) continue;                     // skip tables
    // Wikilinks aren't in the preview pipeline; render their display text inline.
    p = p.replace(/!?\[\[([^\[\]|#\n]+?)(?:#[^\[\]|#\n]+?)?(?:\|([^\[\]#\n]+?))?\]\]/g,
      (_, name: string, alias?: string) => alias ?? name);
    out.push(p);
    total += p.length;
    if (total >= maxChars) break;
  }
  return out.join("\n\n");
}

