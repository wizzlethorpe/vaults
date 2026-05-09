// Tiny inline-markdown formatter shared by the built-in `fm` and `statblock`
// handlers. Both render frontmatter scalars or bespoke content directly to
// HTML rather than re-feeding it through the full markdown pipeline, but
// authors still expect basic ** ** / * * / `` markup to survive. This is
// the smallest formatter that supports that.
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
