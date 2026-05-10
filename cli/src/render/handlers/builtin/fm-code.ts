// Built-in code-block `fm` handler — renders a frontmatter value as a fenced
// code block, with an optional language hint via the fence meta string.
//
// Usage:
//
//   ```fm javascript
//   foundry.data.command
//   ```
//
// Renders as:
//
//   <pre><code class="language-javascript">…value of frontmatter.foundry.data.command…</code></pre>
//
// Companion to the inline `fm:` handler. Inline form is used in prose to
// pull a frontmatter value into a sentence; this code-block form is used
// when the value IS code (or otherwise wants a `<pre>` wrapper) and you
// want a single source of truth for that code rather than duplicating it
// between the frontmatter and the page body.
//
// The body of the fence is the dot-path (single token, leading/trailing
// whitespace tolerated). Anything beyond the lang on the fence is the
// optional language hint — `lang className="language-…"` so client-side
// highlighters can pick it up. Missing path or non-string value renders
// as a visible warning marker rather than failing the build, same policy
// as the inline handler.

import type { CodeBlockHandler } from "../types.js";
import { htmlEscape } from "../../../escape.js";
import { lookup } from "./fm.js";

export const fmCodeHandler: CodeBlockHandler = {
  codeBlock: "fm",
  render(content, ctx) {
    const path = content.trim();
    if (!path) return missing("(empty)");
    const value = lookup(ctx.frontmatter, path);
    if (typeof value !== "string") return missing(`${path}: not a string`);
    const langClass = ctx.codeBlockMeta
      ? ` class="language-${htmlEscape(ctx.codeBlockMeta)}"`
      : "";
    return {
      html: `<pre><code${langClass}>${htmlEscape(value)}</code></pre>`,
    };
  },
};

function missing(key: string): { html: string } {
  return {
    html: `<pre><code class="fm-missing" title="frontmatter key not found">{{${htmlEscape(key)}}}</code></pre>`,
  };
}
