import type { Plugin } from "unified";
import type { Root, Html, Paragraph, RootContent, BlockContent, DefinitionContent } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { RenderContext, RenderWarning } from "./types.js";
import { slugify } from "./slug.js";
import { stripFrontmatter } from "./frontmatter.js";
import { escapeRegex } from "../escape.js";
import { renderBase } from "./bases.js";

import { AUDIO_EXT_RE, IMAGE_EXT_RE, PASSTHROUGH_EXT_RE, VIDEO_EXT_RE } from "./extensions.js";

// Anything we know how to render inline from a `![[file.ext]]` embed: images
// become <img>, audio <audio controls>, video <video controls>, and any other
// passthrough (PDF, epub, JSON, …) collapses to a plain link to the file.
// Used to short-circuit the page-transclusion path for media so a stray
// audio embed doesn't get treated as a missing-page transclusion. Union of
// IMAGE_EXT_RE + PASSTHROUGH_EXT_RE — both classes are handled by the inline
// pass downstream, regardless of which sub-branch they take.
function isMediaEmbed(name: string): boolean {
  return IMAGE_EXT_RE.test(name) || PASSTHROUGH_EXT_RE.test(name);
}
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
      // Media embeds (image / audio / video / other passthroughs) are handled
      // by the inline pass below as `<img>` / `<audio>` / `<video>` / `<a>`.
      // Skipping them here prevents the page-transclusion branch from
      // treating a stray `![[file.ogg]]` paragraph as a missing page.
      if (isMediaEmbed(name)) continue;

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

    // 2. Inline media embeds. Each branch picks the right HTML based on
    //    extension class:
    //      - image  → <img>
    //      - audio  → <audio controls>
    //      - video  → <video controls>
    //      - other passthrough (PDF, epub, JSON) → <a> link to the file
    //    Anything else falls through to the wikilink resolver later in
    //    the pipeline (which will treat it as a page reference).
    findAndReplace(tree, [
      [
        EMBED_INLINE_RE,
        (_match: string, rawName: string, _rawAnchor?: string, rawAlias?: string) => {
          const name = rawName.trim();
          if (IMAGE_EXT_RE.test(name)) return imageEmbed(name, rawAlias?.trim(), context, warnings);
          if (AUDIO_EXT_RE.test(name)) return mediaEmbed(name, "audio", context);
          if (VIDEO_EXT_RE.test(name)) return mediaEmbed(name, "video", context);
          if (PASSTHROUGH_EXT_RE.test(name)) return passthroughLink(name, context);
          return false;
        },
      ],
    ]);
  };
}

function imageEmbed(name: string, alias: string | undefined, context: RenderContext, warnings?: RenderWarning[]): Html {
  const slug = slugify(name);
  const image = context.images.get(slug);
  if (!image && warnings) warnings.push({ kind: "missing-image", target: name });
  const path = image?.outputPath ?? name;
  const src = "/" + path.split("/").map(encodeURIComponent).join("/");
  const explicit = parseSizeHint(alias);
  // When no explicit |N hint, fall through to a class; the actual width
  // is set via a CSS variable on <body> so it stays configurable and
  // sanitize-safe (no inline styles on user-controlled HTML).
  const extra = explicit || (context.defaultImageWidth ? ` class="default-width"` : "");
  return {
    type: "html",
    value: `<img src="${escAttr(src)}" alt="${escAttr(name)}" loading="lazy"${extra}>`,
  };
}

/** Render a passthrough media embed as an inline player (audio / video). */
function mediaEmbed(name: string, kind: "audio" | "video", context: RenderContext): Html {
  const src = passthroughUrl(name, context);
  const tag = kind;
  return {
    type: "html",
    value: `<${tag} controls preload="metadata" src="${escAttr(src)}"></${tag}>`,
  };
}

/** Render a non-media passthrough embed (PDF / epub / JSON) as a plain link. */
function passthroughLink(name: string, context: RenderContext): Html {
  const src = passthroughUrl(name, context);
  return {
    type: "html",
    value: `<a class="passthrough-link" href="${escAttr(src)}">${escAttr(name)}</a>`,
  };
}

/** Resolve a passthrough filename to its served URL via the build's index.
 *  Falls back to the bare name as a last resort so the rendered link still
 *  points somewhere even if the build never picked the file up. */
function passthroughUrl(name: string, context: RenderContext): string {
  const slug = slugify(name);
  const entry = context.passthroughs?.get(slug);
  const path = entry?.outputPath ?? name;
  return "/" + path.split("/").map(encodeURIComponent).join("/");
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
    // Media embeds are handled by the inline pass downstream; leave them
    // as-is here so this string-level expansion only chases page transclusions.
    if (isMediaEmbed(name)) return line;
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

function extractSection(body: string, anchor: string): string | null {
  // Obsidian block references: `[[Page#^block-id]]` resolves to the block
  // (paragraph or list item) ending with `^block-id`. The marker sits at
  // the END of the block; in source it is either trailing on the last line
  // or alone on a line directly after the block.
  if (anchor.startsWith("^")) {
    return extractBlock(body, anchor.slice(1));
  }
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

// Find the block (paragraph or list item) terminated by `^<id>`. The marker
// is either trailing on the block's last line (`Some text ^id`) or alone on
// the line immediately after the block. Returns the block content with the
// marker stripped, or null if no such block exists.
function extractBlock(body: string, blockId: string): string | null {
  const lines = body.split("\n");
  const trailRe = new RegExp(`(?:^|\\s)\\^${escapeRegex(blockId)}\\s*$`);
  const aloneRe = new RegExp(`^\\s*\\^${escapeRegex(blockId)}\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Trailing form: marker on the same line as the block's last text.
    if (trailRe.test(line) && !aloneRe.test(line)) {
      const start = blockStart(lines, i);
      const block = lines.slice(start, i + 1).join("\n");
      return block.replace(trailRe, "").trimEnd();
    }
    // Alone-on-its-own-line form: previous non-empty line ends the block.
    if (aloneRe.test(line)) {
      let end = i - 1;
      while (end >= 0 && lines[end]!.trim() === "") end--;
      if (end < 0) continue;
      const start = blockStart(lines, end);
      return lines.slice(start, end + 1).join("\n").trimEnd();
    }
  }
  return null;
}

function blockStart(lines: string[], end: number): number {
  let start = end;
  while (start > 0 && lines[start - 1]!.trim() !== "") start--;
  return start;
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
