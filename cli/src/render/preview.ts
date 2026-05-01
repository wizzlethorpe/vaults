import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

// Builds compact JSON preview blobs at build time for hover popovers.
// One file per page, served alongside the rendered .html as `<path>.preview.json`.
//
// Summaries are rendered to sanitised HTML (a few paragraphs at most) so the
// popover shows formatted content rather than stripped plain text.

export interface PagePreview {
  title: string;
  /** Rendered HTML — already sanitised. Safe to insert via innerHTML. */
  summary: string;
  /** anchor → { title, summary HTML } for [[Page#section]] hovers. */
  headings: Record<string, { title: string; summary: string }>;
}

const SUMMARY_CHARS = 320;

const previewPipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, {
    ...defaultSchema,
    // Strip away anything heavy or risky for a tiny popover.
    tagNames: defaultSchema.tagNames?.filter((t) => !["img", "iframe", "video"].includes(t)),
  })
  .use(rehypeStringify);

export async function buildPreview(rawMarkdown: string, title: string): Promise<PagePreview> {
  const body = stripFrontmatter(rawMarkdown).trim();
  const summary = await renderSnippet(body);

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
      summary: await renderSnippet(sectionBody),
    };
  }
  return { title, summary, headings };
}

/**
 * Truncate the markdown to the first ~SUMMARY_CHARS of body content (skipping
 * headings, image embeds, tables) and render it to sanitised HTML.
 */
async function renderSnippet(source: string): Promise<string> {
  const truncated = truncateMarkdown(source.trim(), SUMMARY_CHARS);
  if (!truncated) return "";
  const file = await previewPipeline.process(truncated);
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
    // Wikilinks aren't in the preview pipeline — render their display text inline.
    p = p.replace(/!?\[\[([^\[\]|#\n]+?)(?:#[^\[\]|#\n]+?)?(?:\|([^\[\]#\n]+?))?\]\]/g,
      (_, name: string, alias?: string) => alias ?? name);
    out.push(p);
    total += p.length;
    if (total >= maxChars) break;
  }
  return out.join("\n\n");
}

function stripFrontmatter(s: string): string {
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
