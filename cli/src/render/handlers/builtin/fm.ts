// Built-in inline `fm:` handler — inserts a frontmatter value into prose.
//
//   ---
//   class: Wizard
//   level: 7
//   ---
//   The `fm: class` is level `fm: level`.
//
// Renders as: "The Wizard is level 7."
//
// String/number/boolean values are inserted as markdown so authors can put
// inline markup in frontmatter (e.g. "**Wizard**") and have it render. Dates
// (YAML auto-parses ISO 8601 strings to Date) format as YYYY-MM-DD. Arrays
// are joined with ", ". Missing keys and unsupported value shapes (plain
// objects, null) render a visible warning marker so the page surfaces the
// problem instead of silently emitting "undefined".

import type { InlineHandler } from "../types.js";
import { htmlEscape } from "../types.js";

export const fmHandler: InlineHandler = {
  inline: "fm",
  render(content, ctx) {
    const key = content.trim();
    if (!key) return missing("(empty)");
    const value = ctx.frontmatter[key];
    const formatted = formatScalar(value);
    if (formatted !== null) return { markdown: formatted };
    if (Array.isArray(value)) {
      return { markdown: value.map((v) => formatScalar(v) ?? "").join(", ") };
    }
    return missing(key);
  },
};

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
