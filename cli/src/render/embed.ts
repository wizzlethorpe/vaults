import type { Plugin } from "unified";
import type { Root, Html, Paragraph, RootContent, BlockContent, DefinitionContent } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { RenderContext, RenderWarning } from "./types.js";
import { slugify } from "./slug.js";
import { renderBase } from "./bases.js";

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|tiff?)$/i;
const EMBED_INLINE_RE = /!\[\[([^\[\]|#\n]+?)(?:#([^\[\]|#\n]+?))?(?:\|([^\[\]#\n]*))?\]\]/g;
// A line that is *only* an embed; used for page transclusion.
const EMBED_PARAGRAPH_RE = /^!\[\[([^\[\]|#\n]+?)(?:#([^\[\]|#\n]+?))?(?:\|([^\[\]#\n]*))?\]\]$/;
// Same shape but global, for recursive string expansion of nested embeds.
const EMBED_LINE_RE_G = /^!\[\[([^\[\]|#\n]+?)(?:#([^\[\]|#\n]+?))?(?:\|([^\[\]#\n]*))?\]\]$/gm;
const MAX_DEPTH = 3;

const subParser = unified().use(remarkParse).use(remarkGfm);

export function embedPlugin(opts: {
  context: RenderContext;
  /** Receives warnings for missing pages, sections, and images encountered while rendering. */
  warnings?: RenderWarning[];
}): Plugin<[], Root> {
  const { context, warnings } = opts;

  return () => (tree) => {
    // 1. Page transclusion; paragraphs that are a single embed and not an image.
    const replacements: { index: number; node: RootContent }[] = [];
    for (let i = 0; i < tree.children.length; i++) {
      const child = tree.children[i];
      if (child?.type !== "paragraph") continue;
      const para = child as Paragraph;
      if (para.children.length !== 1 || para.children[0]?.type !== "text") continue;

      const m = EMBED_PARAGRAPH_RE.exec((para.children[0] as { value: string }).value.trim());
      if (!m) continue;
      const [, rawName, rawAnchor] = m;
      const name = rawName!.trim();
      if (IMAGE_EXT_RE.test(name)) continue;

      // ![[Foo]] or ![[Foo#ViewName]] — if Foo.base exists, render that
      // base inline instead of looking up a page transclusion.
      const baseSlug = slugify(name);
      const baseSource = context.bases.get(baseSlug);
      if (baseSource != null) {
        const html = renderBase(baseSource, context, warnings, rawAnchor?.trim());
        replacements.push({ index: i, node: { type: "html", value: html } as Html });
        continue;
      }

      replacements.push({ index: i, node: transcludePage(slugify(name), rawAnchor?.trim(), context, warnings, name) });
    }
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i]!;
      tree.children.splice(r.index, 1, r.node);
    }

    // 2. Inline image embeds.
    findAndReplace(tree, [
      [
        EMBED_INLINE_RE,
        (_match: string, rawName: string, _rawAnchor?: string, rawAlias?: string) => {
          const name = rawName.trim();
          if (!IMAGE_EXT_RE.test(name)) return false;
          const slug = slugify(name);
          const image = context.images.get(slug);
          if (!image && warnings) warnings.push({ kind: "missing-image", target: name });
          const path = image?.outputPath ?? name;
          const src = "/" + path.split("/").map(encodeURIComponent).join("/");
          const explicit = parseSizeHint(rawAlias?.trim());
          // When no explicit |N hint, fall through to a class; the actual
          // width is set via a CSS variable on <body> so it stays configurable
          // and sanitize-safe (no inline styles on user-controlled HTML).
          const extra = explicit
            || (context.defaultImageWidth ? ` class="default-width"` : "");
          return {
            type: "html",
            value: `<img src="${escAttr(src)}" alt="${escAttr(name)}" loading="lazy"${extra}>`,
          } satisfies Html;
        },
      ],
    ]);
  };
}

function transcludePage(
  slug: string,
  anchor: string | undefined,
  context: RenderContext,
  warnings: RenderWarning[] | undefined,
  rawName: string,
): RootContent {
  const source = context.markdownContent.get(slug);
  if (source == null) {
    if (warnings) warnings.push({ kind: "missing-page", target: rawName });
    return brokenEmbed(slug, "(page not found)", "embed-broken");
  }

  let body = stripFrontmatter(source);
  if (anchor) {
    const section = extractSection(body, anchor);
    if (section == null) {
      if (warnings) warnings.push({ kind: "missing-section", target: `${rawName}#${anchor}` });
      return brokenEmbed(slug, "(section not found)", "embed-broken");
    }
    body = section;
  }

  // Recursively expand nested embeds at the string level; no plugin recursion needed.
  const expanded = expandNestedEmbeds(body, context, 1, new Set([slug]));
  const childAst = subParser.parse(expanded) as Root;

  const page = context.pages.get(slug);
  const targetHref = page
    ? "/" + page.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/") + (anchor ? `#${anchor}` : "")
    : "#";
  const sourceLink = anchor ? `↗ ${page?.title ?? slug} › ${anchor}` : `↗ ${page?.title ?? slug}`;

  // Append the source-link paragraph to the transcluded children.
  const children: (BlockContent | DefinitionContent)[] = [
    ...(childAst.children as (BlockContent | DefinitionContent)[]),
    {
      type: "paragraph",
      data: { hName: "div", hProperties: { className: ["embed-source"] } },
      children: [{
        type: "link",
        url: targetHref,
        data: { hProperties: { className: ["internal", "internal-link"] } },
        children: [{ type: "text", value: sourceLink }],
      }],
    } as Paragraph,
  ];

  return {
    type: "blockquote",
    data: { hName: "div", hProperties: { className: ["embed"] } },
    children,
  };
}

/**
 * Recursively expand `![[…]]` lines as raw markdown before parsing.
 * Cycle and depth caps both apply.
 */
function expandNestedEmbeds(
  source: string,
  context: RenderContext,
  depth: number,
  ancestors: Set<string>,
): string {
  if (depth >= MAX_DEPTH) return source;
  return source.replace(EMBED_LINE_RE_G, (line, rawName: string, rawAnchor?: string) => {
    const name = rawName.trim();
    if (IMAGE_EXT_RE.test(name)) return line; // images stay as embeds for the inline pass
    const slug = slugify(name);
    if (ancestors.has(slug)) return `> [!warning] Circular embed of ${name}\n`;
    const target = context.markdownContent.get(slug);
    if (target == null) return `> [!error] Page not found: ${name}\n`;
    let body = stripFrontmatter(target);
    if (rawAnchor) {
      const section = extractSection(body, rawAnchor.trim());
      if (section == null) return `> [!error] Section not found: ${name}#${rawAnchor.trim()}\n`;
      body = section;
    }
    const next = new Set(ancestors); next.add(slug);
    return expandNestedEmbeds(body, context, depth + 1, next);
  });
}

function brokenEmbed(slug: string, message: string, klass: string): RootContent {
  return {
    type: "blockquote",
    data: { hName: "div", hProperties: { className: ["embed", klass] } },
    children: [{
      type: "paragraph",
      children: [{ type: "text", value: `${slug} ${message}` }],
    }],
  };
}

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function extractSection(body: string, anchor: string): string | null {
  const target = slugify(anchor);
  const lines = body.split("\n");
  let inSection = false;
  let level = 0;
  const out: string[] = [];
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const headingLevel = heading[1]!.length;
      const headingSlug = slugify(heading[2]!);
      if (!inSection && headingSlug === target) {
        inSection = true;
        level = headingLevel;
        continue;
      }
      if (inSection && headingLevel <= level) break;
    }
    if (inSection) out.push(line);
  }
  return inSection ? out.join("\n").trim() : null;
}

function parseSizeHint(alias: string | undefined): string {
  if (!alias) return "";
  const m = /^(\d+)(?:x(\d+))?$/.exec(alias);
  if (!m) return "";
  return m[2] != null ? ` width="${m[1]}" height="${m[2]}"` : ` width="${m[1]}"`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
