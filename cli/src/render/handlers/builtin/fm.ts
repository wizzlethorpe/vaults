// Built-in inline `fm:` handler — inserts a frontmatter value into prose.
//
//   ---
//   class: Wizard
//   level: 7
//   stats:
//     hp: 22
//   ---
//   The `fm: class` is level `fm: level` with `fm: stats.hp` HP.
//
// Renders as: "The Wizard is level 7 with 22 HP."
//
// Dot-path lookups (`fm: a.b.c`) walk nested objects. Keys with literal
// dots in their names are unreachable, which we accept because such keys
// are vanishingly rare in vault frontmatter.
//
// String/number/boolean values render as HTML with a small inline-markup
// pass (**bold**, *italic*, `code`) so authors can put light formatting
// in frontmatter and have it survive. Returning HTML rather than markdown
// lets fm work when invoked recursively from another handler (e.g. inside
// a `statblock` field), since the dispatcher only re-pipelines top-level
// markdown returns. Wikilinks in frontmatter are NOT processed; cross-page
// reference belongs in prose.
//
// Dates (YAML auto-parses ISO 8601 strings to Date) format as YYYY-MM-DD.
// Arrays are joined with ", ". Missing keys and unsupported value shapes
// (plain objects, null) render a visible warning marker so the page
// surfaces the problem instead of silently emitting "undefined".

import type { InlineHandler } from "../types.js";
import { htmlEscape } from "../types.js";

export const fmHandler: InlineHandler = {
  inline: "fm",
  render(content, ctx) {
    const path = content.trim();
    if (!path) return missing("(empty)");
    const value = lookup(ctx.frontmatter, path);
    const formatted = formatScalar(value);
    if (formatted !== null) return { html: wrap(formatInline(formatted)) };
    if (Array.isArray(value)) {
      return { html: wrap(formatInline(value.map((v) => formatScalar(v) ?? "").join(", "))) };
    }
    return missing(path);
  },
};

// Bare-text HTML AST nodes get dropped by the markdown → HTML stage
// (rehype-raw needs an actual element to anchor onto in inline contexts);
// wrapping in a <span> keeps the value visible. The span is invisible in
// the final layout so it doesn't change typography.
function wrap(inner: string): string { return `<span class="fm-value">${inner}</span>`; }

function lookup(root: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = root;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

// HTML-escape, then a tiny inline-markdown pass: bold (** **) before italic
// (* *) so bold doesn't get eaten, then code spans. Matches the same subset
// the statblock handler's formatInline supports — keep these in sync.
function formatInline(s: string): string {
  let out = htmlEscape(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

function formatScalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return null;
}

function missing(key: string): { html: string } {
  return {
    html: `<code class="fm-missing" title="frontmatter key not found">{{${htmlEscape(key)}}}</code>`,
  };
}
