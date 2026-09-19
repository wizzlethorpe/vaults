// Tiny inline-markdown formatter for the built-in `fm` handler, which renders frontmatter scalars straight to HTML.
// Authors still expect basic ** ** / * * / `` markup to survive, and this is the smallest formatter that supports that.
//
// Bold runs first (** **) so the italic regex can't gobble its asterisks.
// Italic uses a leading non-`*` guard so `**bold**` doesn't match. Code
// spans run last; their delimiter (`) is HTML-safe after htmlEscape.
//
// Wikilinks are intentionally NOT processed here — wikilink resolution
// requires the full RenderContext and lives in render/wikilink.ts. Authors
// who need wikilinks should put them in regular prose.

import { htmlEscape } from "../../../escape.js";

/**
 * HTML-escape `s`, then apply a small inline-markdown subset
 * (bold, italic, code spans). Returns ready-to-insert HTML.
 */
export function formatInline(s: string): string {
  let out = htmlEscape(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}
