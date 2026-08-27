// Built-in `download` code-block handler.
//
// Renders a gated download for a file that lives in the vault:
//
//   ```download
//   file: releases/spellcraft-markdown.zip
//   label: Spellcraft as markdown
//   note: 8 files, 11 KB
//   ```
//
// The gating is not new machinery. A referenced file is staged into the
// variants of the pages that reference it, and the auth middleware already
// serves `/<path>` out of `_variants/<role>/<path>` — so a download on a
// `role: patron` page ships to the patron variant only and is served only to
// a patron. This handler's job is to make that a first-class thing to author
// rather than a markdown link someone has to know to write.
//
// A Foundry module install link is deliberately NOT this handler. See
// `foundry-manifest`: it hands a URL to a machine that has no cookie, which
// is a different problem with a different answer.

import type { CodeBlockHandler, HandlerContext } from "../types.js";
import { registerBuiltinAssets } from "../assets.js";

/** A ```download block, for the build's per-variant asset scanner. */
const DOWNLOAD_BLOCK_RE = /^```download[^\n]*\n([\s\S]*?)^```/gm;

export interface DownloadSpec {
  file: string;
  label: string;
  note: string;
}

/**
 * Parse a block body's `key: value` lines. Unknown keys are ignored rather
 * than rejected, so a typo degrades to a missing label instead of an error
 * box swallowing the whole download.
 */
export function parseDownloadBlock(content: string): DownloadSpec | null {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep === -1) continue;
    out[trimmed.slice(0, sep).trim().toLowerCase()] = trimmed.slice(sep + 1).trim();
  }
  const file = (out["file"] ?? "").replace(/^\/+/, "");
  if (!file) return null;
  return {
    file,
    label: out["label"] ?? file.split("/").pop() ?? file,
    note: out["note"] ?? "",
  };
}

/** Vault-relative paths named by a page's ```download blocks. */
export function downloadFilePaths(source: string): string[] {
  const paths: string[] = [];
  for (const block of source.matchAll(DOWNLOAD_BLOCK_RE)) {
    const spec = parseDownloadBlock(block[1] ?? "");
    if (spec) paths.push(spec.file);
  }
  return paths;
}

/** Absolute, percent-encoded served URL for a vault-relative path. */
function servedHref(path: string): string {
  return "/" + path.split("/").map(encodeURIComponent).join("/");
}

export const downloadHandler: CodeBlockHandler = {
  codeBlock: "download",
  render(content: string, ctx: HandlerContext): { html: string } {
    const spec = parseDownloadBlock(content);
    if (!spec) {
      return { html: '<div class="vaults-download-error">download: needs a <code>file:</code> line</div>' };
    }
    const esc = ctx.escape;
    const note = spec.note ? `<span class="vaults-download-note">${esc(spec.note)}</span>` : "";
    return {
      html: `<div class="vaults-download">`
        + `<a class="vaults-download-main" href="${esc(servedHref(spec.file))}" download>`
        + `<span class="vaults-download-label">${esc(spec.label)}</span>${note}</a></div>`,
    };
  },
};

const DOWNLOAD_STYLES = `
.vaults-download { border: 1px solid var(--rule, #ccc); border-radius: 6px; padding: .9rem 1rem; margin: 1rem 0; }
.vaults-download-main { display: flex; flex-direction: column; gap: .15rem; text-decoration: none; color: inherit; }
.vaults-download-main:hover .vaults-download-label { text-decoration: underline; }
.vaults-download-label { font-weight: 600; color: var(--accent, #333); }
.vaults-download-note { font-size: .85rem; color: var(--fg-muted, #666); }
.vaults-download-error { border: 1px solid #c33; border-radius: 4px; padding: .6rem .8rem; color: #c33; }
`;


registerBuiltinAssets(downloadHandler, {
  styles: [{ source: "builtin/download.css", content: DOWNLOAD_STYLES }],
});
