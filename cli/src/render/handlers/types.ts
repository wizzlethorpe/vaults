// Handler API for custom inline / code-block transforms.
//
// Vault authors drop `.vaults/handlers/<name>.{js,mjs}` files into their
// vault. Each file exports `handler` (or `handlers: Handler[]`) and the
// loader registers them alongside vaults-cli's built-in handlers.
//
// At render time, the dispatch plugin (handlers/dispatch.ts) walks the
// markdown AST. For each inline-code node `` `prefix: …` `` it looks up an
// InlineHandler keyed on `prefix`. For each fenced ``` ```lang ``` block it
// looks up a CodeBlockHandler keyed on `lang`. The handler's `render()` is
// called with the content and a HandlerContext, and the returned markdown
// or HTML replaces the matched node in the AST.
//
// Build-time only: handlers run during `vaults push` / `vaults build`.
// Their output is static markup. Runtime widget support (handlers shipping
// browser JS) is a separate future feature.

import type { RenderContext } from "../types.js";

/**
 * Context passed to a handler's render() function.
 */
export interface HandlerContext {
  /** Vault-relative path of the page being rendered (e.g. "NPCs/Aldric.md"). */
  pagePath: string;
  /** The rendering page's parsed frontmatter. */
  frontmatter: Record<string, unknown>;
  /** Underlying render context (pages, images, vault settings, …). Use sparingly. */
  render: RenderContext;
  /** HTML-escape a string. Convenience helper. */
  escape(s: string): string;
  /**
   * Apply registered inline handlers to a plain string and return HTML.
   * Use this when a handler renders its own non-markdown content (e.g. a
   * statblock's bespoke layout) and wants to support nested inline handlers
   * like `dice:` inside that content. Only handlers that return HTML are
   * substituted; markdown-emitting handlers are left as their original
   * `` `prefix: …` `` text. Other inline formatting (bold, italic, code,
   * wikilinks) is the caller's responsibility.
   */
  applyInlineHandlers(text: string): Promise<string>;
}

/**
 * A handler returns either markdown to be re-processed through the rest of
 * the pipeline, or raw HTML to be inserted as-is (sanitized downstream).
 *
 * Inline handlers should return inline-flow content; code-block handlers
 * should return block-flow content.
 */
export type HandlerOutput =
  | { markdown: string }
  | { html: string };

/**
 * Browser-side assets a handler ships alongside its rendered HTML. Paths
 * are resolved relative to the handler module's own file by the loader, so
 * a handler living at `.vaults/handlers/spellcraft.mjs` can reference
 * `./spellcraft.runtime.js` and the build will pick it up.
 *
 * All declared script files are concatenated into one `_handlers.js` at
 * the deploy root; styles into one `_handlers.css`. Each unique source
 * file is included exactly once, even if multiple handlers reference it,
 * so shared utility files don't duplicate.
 */
export interface HandlerAssets {
  /** Browser-side JS source files. Wrap your code in an IIFE to avoid global pollution. */
  scripts?: string[];
  /** Stylesheet source files. */
  styles?: string[];
}

export interface InlineHandler {
  /** Discriminator that appears before the colon in `` `prefix: …` ``. */
  inline: string;
  /** Browser-side JS / CSS to ship as part of the deploy. */
  assets?: HandlerAssets;
  render(content: string, ctx: HandlerContext): HandlerOutput | Promise<HandlerOutput>;
}

export interface CodeBlockHandler {
  /** Language tag for ``` ```lang ``` ```. */
  codeBlock: string;
  assets?: HandlerAssets;
  render(content: string, ctx: HandlerContext): HandlerOutput | Promise<HandlerOutput>;
}

export type Handler = InlineHandler | CodeBlockHandler;

/**
 * Resolved handler registry. Two maps so dispatch is O(1) per node.
 */
export interface HandlerRegistry {
  inline: Map<string, InlineHandler>;
  codeBlock: Map<string, CodeBlockHandler>;
}

export function buildRegistry(handlers: Handler[]): HandlerRegistry {
  const inline = new Map<string, InlineHandler>();
  const codeBlock = new Map<string, CodeBlockHandler>();
  for (const h of handlers) {
    // Last-registered wins on conflict; user handlers loaded after built-ins
    // can therefore override the built-in.
    if ("inline" in h) inline.set(h.inline, h);
    else codeBlock.set(h.codeBlock, h);
  }
  return { inline, codeBlock };
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]!);
}
