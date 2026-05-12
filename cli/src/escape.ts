// Canonical HTML-escape helpers shared across the CLI.
//
// `htmlEscape` covers all five characters (& < > " ') for both text-content
// and attribute-value contexts; that strict superset is correct everywhere
// HTML is being assembled by string concatenation. `htmlAttr` is provided for
// the few callers that still want attribute-only escaping (& " <), which is
// strictly narrower; prefer `htmlEscape` unless you have a reason.
//
// Re-exported from `cli/src/render/handlers/types.ts` (the canonical name
// handlers see); existing imports there keep working.

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

export function htmlAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => HTML_ESCAPE[c]!);
}

/** Escape every regex metacharacter so the result is safe to use as a
 *  literal-match needle inside a RegExp constructor. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
