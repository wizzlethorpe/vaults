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

const HTML_NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'",
};

/**
 * Undo attribute escaping, so an attribute value can be read as the string a
 * browser would see. Anything reading an href out of serialized HTML needs
 * this: the serializer escapes `'` to `&#x27;`, and percent-decoding alone
 * leaves the entity sitting in the middle of the path.
 */
export function htmlUnescape(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return HTML_NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Escape every regex metacharacter so the result is safe to use as a
 *  literal-match needle inside a RegExp constructor. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
