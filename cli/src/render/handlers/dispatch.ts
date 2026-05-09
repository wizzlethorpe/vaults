// Unified plugin that runs registered handlers over the markdown AST.
//
// For each inline-code node `` `prefix: …` ``, look up an InlineHandler
// keyed on `prefix`; if found, replace the node with the handler's output.
//
// For each fenced ``` ```lang ``` ``` block, look up a CodeBlockHandler
// keyed on `lang`; if found, replace the node with the handler's output.
//
// Output is parsed back into mdast (when markdown) or wrapped as a raw HTML
// node (when html). Either way, the rest of the pipeline (wikilinks,
// embeds, sanitization) sees the substituted content normally.
//
// Recursion: the walker descends into handler-emitted markdown and runs
// the registry against it again, so a handler that returns text
// containing `dice: 1d20` produces a real dice button. Bounded by
// MAX_DEPTH so a self-referential handler can't loop forever.
//
// Runs early in the pipeline so handler-emitted markdown still picks up
// wikilink / embed processing downstream.

import type { Plugin } from "unified";
import type { Root, RootContent, Code, InlineCode, Paragraph, Html as MdHtml, PhrasingContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { HandlerContext, HandlerOutput, HandlerRegistry } from "./types.js";

interface DispatchOpts {
  context: HandlerContext;
  registry: HandlerRegistry;
}

/** Cap on handler-emits-handler recursion. Realistically nothing legitimate nests this deep. */
const MAX_DEPTH = 10;

/**
 * Single sub-parser instance reused across every handler that returns
 * markdown. Hoisted so the .use() chain isn't rebuilt per call.
 */
const SUB_PARSER = unified().use(remarkParse).use(remarkGfm);

function asHtmlNode(html: string): MdHtml {
  return { type: "html", value: html };
}

/** Parse a markdown string into a list of mdast block-level children. */
function parseMarkdownBlocks(source: string): RootContent[] {
  return (SUB_PARSER.parse(source) as Root).children;
}

/**
 * Parse a markdown string and pull out its inline (phrasing) content. Drops
 * the surrounding paragraph wrapper so the inline content can be spliced
 * into a phrasing context.
 */
function parseMarkdownInline(source: string): PhrasingContent[] {
  const blocks = parseMarkdownBlocks(source);
  const out: PhrasingContent[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      out.push(...(block as Paragraph).children);
    } else {
      // Block-level output in an inline context: drop. A handler author who
      // needs block flow should use a code-block handler, not an inline one.
      // Empty html node keeps the document well-formed.
      out.push(asHtmlNode(""));
    }
  }
  return out;
}

function outputToBlock(out: HandlerOutput): RootContent[] {
  if ("markdown" in out) return parseMarkdownBlocks(out.markdown);
  return [asHtmlNode(out.html)];
}

function outputToInline(out: HandlerOutput): PhrasingContent[] {
  if ("markdown" in out) return parseMarkdownInline(out.markdown);
  return [asHtmlNode(out.html)];
}

/**
 * Walk the AST forward, applying any matching handler to each inline-code
 * and code node. After a substitution, the replacements get re-walked at
 * depth+1 — this handles both:
 *   (a) **vertical** recursion: a paragraph the handler emitted contains
 *       further handler-eligible inline nodes (e.g., a `dice:` inside a
 *       custom code-block's emitted markdown).
 *   (b) **horizontal** recursion: the replacement is itself directly
 *       handler-eligible (e.g., a `loop:` handler emitting another
 *       `loop:`). Bounded by MAX_DEPTH so a self-emitting handler can't
 *       loop forever.
 */
async function walkAndSubstitute(
  parent: { children: any[] },
  registry: HandlerRegistry,
  context: HandlerContext,
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) {
    console.warn(`  handlers: recursion depth ${depth} exceeded; stopping`);
    return;
  }
  let i = 0;
  while (i < parent.children.length) {
    const node = parent.children[i];
    const replacements = await dispatchOne(node, registry, context);
    if (replacements !== null) {
      parent.children.splice(i, 1, ...replacements);
      // Wrap the replacement slice and re-walk it at depth+1. The nested
      // walk handles both horizontal and vertical recursion for the new
      // content. Splice back the (possibly further-substituted) result.
      const synth = { children: parent.children.slice(i, i + replacements.length) };
      await walkAndSubstitute(synth, registry, context, depth + 1);
      parent.children.splice(i, replacements.length, ...synth.children);
      i += synth.children.length;
      continue;
    }
    if (Array.isArray(node.children)) {
      await walkAndSubstitute(node, registry, context, depth + 1);
    }
    i += 1;
  }
}

/**
 * Returns the replacement nodes for `node` if a handler matched, else null.
 * Inline-code nodes return PhrasingContent[]; code nodes return RootContent[].
 * The caller is responsible for splicing into the right parent.
 */
async function dispatchOne(
  node: any,
  registry: HandlerRegistry,
  context: HandlerContext,
): Promise<RootContent[] | PhrasingContent[] | null> {
  if (node?.type === "inlineCode") {
    const value = (node as InlineCode).value;
    const colon = value.indexOf(":");
    if (colon < 1) return null;
    const prefix = value.slice(0, colon).trim();
    const handler = registry.inline.get(prefix);
    if (!handler) return null;
    const content = value.slice(colon + 1).trim();
    return outputToInline(await handler.render(content, context));
  }
  if (node?.type === "code") {
    const lang = ((node as Code).lang ?? "").trim();
    if (!lang) return null;
    const handler = registry.codeBlock.get(lang);
    if (!handler) return null;
    return outputToBlock(await handler.render((node as Code).value, context));
  }
  return null;
}

export function handlersPlugin(opts: DispatchOpts): Plugin<[], Root> {
  const { registry, context } = opts;
  return () => async (tree: Root) => {
    await walkAndSubstitute(tree as { children: any[] }, registry, context, 0);
  };
}
