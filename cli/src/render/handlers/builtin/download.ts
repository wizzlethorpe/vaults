// Built-in `download` code-block handler.
//
// Renders a gated download for a file that lives in the vault:
//
//   ```download
//   file: releases/spellcraft-module.zip
//   label: Spellcraft for Foundry
//   note: v1.0.0
//   manifest: releases/module.json
//   ```
//
// The gating is not new machinery. A referenced file is staged into the
// variants of the pages that reference it, and the auth middleware already
// serves `/<path>` out of `_variants/<role>/<path>` — so a download on a
// `role: patron` page ships to the patron variant only and is served only to
// a patron. This handler's job is to make that a first-class thing to author
// rather than a markdown link someone has to know to write.
//
// `manifest:` marks the download as a Foundry module and adds a second
// affordance. Foundry's installer runs on the Foundry *server*, so it never
// carries the browser's session cookie; it needs a URL that authenticates on
// its own. The button asks the deploy for a short-lived `?_token=` link and
// puts it on the clipboard.

import type { CodeBlockHandler, HandlerContext } from "../types.js";
import { registerBuiltinAssets } from "../assets.js";

/** A ```download block, for the build's per-variant asset scanner. */
const DOWNLOAD_BLOCK_RE = /^```download[^\n]*\n([\s\S]*?)^```/gm;

export interface DownloadSpec {
  file: string;
  label: string;
  note: string;
  manifest: string;
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
    manifest: (out["manifest"] ?? "").replace(/^\/+/, ""),
  };
}

/** Vault-relative paths named by a page's ```download blocks. */
export function downloadFilePaths(source: string): string[] {
  const paths: string[] = [];
  for (const block of source.matchAll(DOWNLOAD_BLOCK_RE)) {
    const spec = parseDownloadBlock(block[1] ?? "");
    if (!spec) continue;
    paths.push(spec.file);
    if (spec.manifest) paths.push(spec.manifest);
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
    const href = servedHref(spec.file);
    const parts = [
      `<div class="vaults-download">`,
      `<a class="vaults-download-main" href="${esc(href)}" download>`,
      `<span class="vaults-download-label">${esc(spec.label)}</span>`,
      spec.note ? `<span class="vaults-download-note">${esc(spec.note)}</span>` : "",
      `</a>`,
    ];

    if (spec.manifest) {
      // The link is minted per click rather than baked in: it is short-lived
      // by design, so a copy rendered at build time would be stale before
      // anyone read the page.
      parts.push(
        `<button class="vaults-download-manifest" type="button"`,
        ` data-manifest="${esc(servedHref(spec.manifest))}">Copy install link</button>`,
        `<p class="vaults-download-hint">Paste into Foundry's <em>Install Module</em> dialog.`,
        ` The link expires shortly, and Foundry cannot check for updates through it —`,
        ` copy a fresh one to upgrade.</p>`,
      );
    }
    parts.push(`</div>`);
    return { html: parts.join("") };
  },
};

const DOWNLOAD_STYLES = `
.vaults-download { border: 1px solid var(--rule, #ccc); border-radius: 6px; padding: .9rem 1rem; margin: 1rem 0; }
.vaults-download-main { display: flex; flex-direction: column; gap: .15rem; text-decoration: none; color: inherit; }
.vaults-download-main:hover .vaults-download-label { text-decoration: underline; }
.vaults-download-label { font-weight: 600; color: var(--accent, #333); }
.vaults-download-note { font-size: .85rem; color: var(--fg-muted, #666); }
.vaults-download-manifest { font: inherit; font-size: .85rem; margin-top: .7rem; padding: .35rem .8rem; border: 1px solid var(--rule, #ccc); border-radius: 4px; background: var(--bg, #fff); color: var(--fg, #222); cursor: pointer; }
.vaults-download-manifest:hover { border-color: var(--accent, #333); }
.vaults-download-hint { font-size: .8rem; color: var(--fg-muted, #666); margin: .5rem 0 0; }
.vaults-download-error { border: 1px solid #c33; border-radius: 4px; padding: .6rem .8rem; color: #c33; }
`;

// Asks the deploy to mint a short-lived link, then puts it on the clipboard.
// Minted per click because it expires: a URL baked in at build time would be
// dead long before anyone pressed the button.
const DOWNLOAD_RUNTIME = `
(function () {
  document.addEventListener("click", async function (e) {
    var btn = e.target.closest(".vaults-download-manifest");
    if (!btn) return;
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      var res = await fetch("/_link?path=" + encodeURIComponent(btn.dataset.manifest), { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      var data = await res.json();
      await navigator.clipboard.writeText(data.url);
      btn.textContent = "Copied — expires in " + data.expiresInMinutes + " min";
    } catch (err) {
      btn.textContent = "Couldn't generate a link";
    } finally {
      btn.disabled = false;
      setTimeout(function () { btn.textContent = original; }, 6000);
    }
  });
})();
`;

registerBuiltinAssets(downloadHandler, {
  scripts: [{ source: "builtin/download.runtime.js", content: DOWNLOAD_RUNTIME }],
  styles: [{ source: "builtin/download.css", content: DOWNLOAD_STYLES }],
});
