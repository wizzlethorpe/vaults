// Built-in `foundry-install` code-block handler: a download button for the
// reader's own grafts.json, which they build into Foundry with graft.
//
//   ```foundry-install
//   label: Install Spellcraft in Foundry
//   note: Needs the Graft module
//   ```

import { type CodeBlockHandler, type HandlerContext } from "@wizzlethorpe/vaults/addon";

const INSTALL_BLOCK_RE = /^```foundry-install[^\n]*\n([\s\S]*?)^```/gm;

/** The path a deployed vault serves the reader's own entry list from. */
export const GRAFTS_PATH = "/_foundry/grafts.json";

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
  return { label: out["label"] ?? "Add to Foundry VTT", note: out["note"] ?? "" };
}

/** Whether a page asks for the download box, which a vault writing no grafts.json cannot answer. */
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
        `<a class="vaults-install-download" href="${GRAFTS_PATH}" download="grafts.json">Download grafts.json</a>`,
        `<p class="vaults-install-hint">Import it with <em>Import grafts</em> on Graft's settings tab. The link inside it expires in two hours; download it again for newer content.</p>`,
        `</div>`,
      ].join(""),
    };
  },
};

const INSTALL_STYLES = `
.vaults-foundry-install { display: flex; flex-direction: column; gap: .15rem; border: 1px solid var(--rule, #ccc); border-radius: 4px; padding: .8rem; }
.vaults-install-label { font-weight: 600; }
.vaults-install-note { font-size: .85rem; color: var(--fg-muted, #666); }
.vaults-install-download { font: inherit; font-size: .85rem; margin-top: .6rem; align-self: flex-start; padding: .35rem .8rem; border: 1px solid var(--rule, #ccc); border-radius: 4px; background: var(--bg, #fff); color: var(--fg, #222); text-decoration: none; cursor: pointer; }
.vaults-install-download:hover { border-color: var(--accent, #333); }
.vaults-install-hint { font-size: .8rem; color: var(--fg-muted, #666); margin: .5rem 0 0; }
`;

foundryInstallHandler.inlineAssets = {
  styles: [{ source: "builtin/foundry-install.css", content: INSTALL_STYLES }],
};
