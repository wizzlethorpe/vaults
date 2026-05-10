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
import { basesPlugin } from "./bases.js";
import { handlersPlugin } from "./handlers/dispatch.js";
import { htmlEscape } from "../escape.js";

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: "",
  // Bases emit interactive HTML beyond what the default schema allows:
  // <input> (filter), <button> (tab buttons + dialog actions). Add them
  // and the attributes they need to function.
  tagNames: [...(defaultSchema.tagNames ?? []), "input", "button", "audio", "video", "source"],
  attributes: {
    ...defaultSchema.attributes,
    // role + aria-selected/haspopup/label ride on tabs, dialogs, etc.
    // `hidden` is essential — Bases tab panels and card-filter rows toggle
    // it from JS to show/hide elements. Without it on the allowlist the
    // initial render shows everything because the sanitizer strips it.
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "role", "ariaSelected", "ariaLabel", "ariaHaspopup", "tabindex", "hidden"],
    img: ["src", "alt", "width", "height", "loading"],
    audio: ["src", "controls", "preload", "loop", "muted"],
    video: ["src", "controls", "preload", "loop", "muted", "width", "height", "poster"],
    source: ["src", "type"],
    a: ["href", "title", "className", "id"],
    div: ["className", "data*", "role"],
    span: ["className", "data*"],
    code: ["className", "title"],
    table: ["className"],
    th: ["className", "data*", "tabindex"],
    td: ["className", "data*"],
    tr: ["className", "data*"],
    input: ["type", "placeholder", "className", "ariaLabel"],
    button: ["type", "className", "data*", "role", "ariaSelected", "ariaLabel", "ariaHaspopup", "tabindex", "title"],
    // Foldable callouts emit <details open>; the default schema allows
    // `open` on <summary> only.
    details: ["className", "data*", "open"],
  },
  // The default schema forces <input> to type=checkbox and disabled=true
  // to safely render GFM task lists. We don't render task lists here, and
  // the Bases filter input needs to be a writable search box, so reset.
  required: { ...(defaultSchema.required ?? {}), input: {} },
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

/**
 * Optional pre-parsed frontmatter passed in by the build pipeline so we don't
 * have to re-run gray-matter on every page. When omitted, we fall back to
 * parsing the source ourselves — keeps single-call entry points (tests,
 * one-off renders) working without forcing them to do the parse first.
 */
export interface PreParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

export async function renderMarkdown(
  source: string,
  context: RenderContext,
  fallbackTitle: string,
  preParsed?: PreParsedFrontmatter,
): Promise<RenderResult> {
  const parsed = preParsed ?? (() => {
    const m = matter(source);
    return { data: (m.data ?? {}) as Record<string, unknown>, content: m.content };
  })();
  const fm = parsed.data;
  const outlinks: string[] = [];
  const warnings: RenderWarning[] = [];

  // Pre-process the markdown source before parsing.
  //   1. Strip Obsidian-style comments (%% ... %%; single- or multi-line).
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
    // Handlers run early so any markdown they emit is processed by the
    // rest of the pipeline (wikilinks resolve, embeds inline, etc.).
    // Empty registry (no built-ins, no user handlers) short-circuits to
    // a no-op walk.
    .use(handlersPlugin({
      registry: context.handlers ?? { inline: new Map(), codeBlock: new Map() },
      context: {
        pagePath: fallbackTitle,
        frontmatter: fm,
        render: context,
        escape: htmlEscape,
      },
    }))
    .use(calloutPlugin({ redactRoles: context.redactRoles }))
    // Bases runs before wikilink/embed: it consumes ```base code fences
    // wholesale and emits raw HTML, so downstream plugins won't try to
    // process anything inside the table.
    .use(basesPlugin({ context, warnings }))
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
