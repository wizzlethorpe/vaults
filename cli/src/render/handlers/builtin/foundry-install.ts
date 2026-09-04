// Built-in `foundry-install` code-block handler.
//
//   ```foundry-install
//   label: Install Spellcraft in Foundry
//   note: Needs the Graft module
//   ```
//
// Renders the install URL for the module this vault builds for itself, the
// one served at `/_foundry/module.json`. That path is ungated even on a gated
// vault, so there is nothing to mint and nothing to authenticate: the box just
// shows the URL and copies it.
//
// The absolute URL is filled in by the page, not the build, because the build
// does not know which host the reader arrived on and a vault can answer to
// more than one.

import type { CodeBlockHandler, HandlerContext } from "../types.js";
import { registerBuiltinAssets } from "../assets.js";

const INSTALL_BLOCK_RE = /^```foundry-install[^\n]*\n([\s\S]*?)^```/gm;

/** The path a deployed vault serves its own module manifest from. */
export const MANIFEST_PATH = "/_foundry/module.json";

export interface InstallSpec {
  label: string;
  note: string;
}

export function parseInstallBlock(content: string): InstallSpec {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep === -1) continue;
    out[trimmed.slice(0, sep).trim().toLowerCase()] = trimmed.slice(sep + 1).trim();
  }
  return { label: out["label"] ?? "Install in Foundry VTT", note: out["note"] ?? "" };
}

/** Whether a page asks for an install box, which a vault building no module cannot answer. */
export function hasFoundryInstall(source: string): boolean {
  INSTALL_BLOCK_RE.lastIndex = 0;
  return INSTALL_BLOCK_RE.test(source);
}

export const foundryInstallHandler: CodeBlockHandler = {
  codeBlock: "foundry-install",
  render(content: string, ctx: HandlerContext): { html: string } {
    const spec = parseInstallBlock(content);
    const esc = ctx.escape;
    return {
      html: [
        `<div class="vaults-foundry-install">`,
        `<span class="vaults-install-label">${esc(spec.label)}</span>`,
        spec.note ? `<span class="vaults-install-note">${esc(spec.note)}</span>` : "",
        `<code class="vaults-install-url" data-path="${MANIFEST_PATH}">${MANIFEST_PATH}</code>`,
        `<button class="vaults-install-copy" type="button">Copy install link</button>`,
        `<p class="vaults-install-hint">Paste into Foundry's <em>Install Module</em> dialog.</p>`,
        `</div>`,
      ].join(""),
    };
  },
};

const INSTALL_STYLES = `
.vaults-foundry-install { display: flex; flex-direction: column; gap: .15rem; border: 1px solid var(--rule, #ccc); border-radius: 4px; padding: .8rem; }
.vaults-install-label { font-weight: 600; }
.vaults-install-note { font-size: .85rem; color: var(--fg-muted, #666); }
.vaults-install-url { display: block; overflow-x: auto; white-space: nowrap; font-size: .8rem; margin-top: .5rem; padding: .35rem .5rem; border-radius: 3px; background: var(--bg-alt, #0001); }
.vaults-install-copy { font: inherit; font-size: .85rem; margin-top: .6rem; align-self: flex-start; padding: .35rem .8rem; border: 1px solid var(--rule, #ccc); border-radius: 4px; background: var(--bg, #fff); color: var(--fg, #222); cursor: pointer; }
.vaults-install-copy:hover { border-color: var(--accent, #333); }
.vaults-install-hint { font-size: .8rem; color: var(--fg-muted, #666); margin: .5rem 0 0; }
`;

// The host is only knowable in the browser: a vault can be served from more
// than one, and Foundry's installer needs an absolute URL.
const INSTALL_RUNTIME = `
(function () {
  function absolute(el) { return new URL(el.dataset.path, location.href).href; }
  document.querySelectorAll(".vaults-install-url").forEach(function (el) {
    el.textContent = absolute(el);
  });
  document.addEventListener("click", async function (e) {
    var btn = e.target.closest(".vaults-install-copy");
    if (!btn) return;
    var url = btn.parentNode.querySelector(".vaults-install-url");
    var original = btn.textContent;
    try {
      await navigator.clipboard.writeText(absolute(url));
      btn.textContent = "Copied";
    } catch (err) {
      btn.textContent = "Couldn't copy — select the URL above";
    }
    setTimeout(function () { btn.textContent = original; }, 4000);
  });
})();
`;

registerBuiltinAssets(foundryInstallHandler, {
  scripts: [{ source: "builtin/foundry-install.runtime.js", content: INSTALL_RUNTIME }],
  styles: [{ source: "builtin/foundry-install.css", content: INSTALL_STYLES }],
});
