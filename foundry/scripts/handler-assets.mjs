// Per-vault handler-asset import. Two-layer consent: a handler author opts
// its assets into Foundry import via assets.targets.foundry.{styles,scripts} on the
// CLI side; a GM enables importHandlerStyles / importHandlerScripts in the
// per-vault settings dialog. This module fetches and injects only when both
// gates allow it.
//
// CSS lands as a <style> in <head>, scoped by `data-vault-id` so disabling
// or removing a vault can clean up exactly its rules. JS lands as a
// <script> with the same data-attribute; scripts execute on insertion (per
// HTML5 spec — element-created <script> tags don't execute, but we use
// document.createElement + body.appendChild which does fire). Re-syncing
// replaces the previous element of the same data-id, so an updated handler
// bundle takes effect without world reload.
//
// Removal: when the GM disables a toggle (or the vault is deleted), drop
// the corresponding data-attributed element. JS removal stops *future*
// script executions; anything the previous script already attached
// (event handlers, hooks) keeps running until reload. The settings-dialog
// hint flags this; we don't try to be clever about JS un-injection.
//
// Two-tier consent UX:
//   - Silent applyHandlerAssets() injects whatever the persistent toggles
//     say. Used from world ready and from settings-save (the GM's already
//     consented persistently; reload doesn't need to re-prompt).
//   - applyHandlerAssetsWithConfirm() pops a per-session prompt before
//     injecting JS. Used only from sync, so a vault that ships new code
//     between syncs gets fresh acknowledgement before it runs. The
//     per-session approval cache means back-to-back syncs in the same
//     session don't nag.
// CSS injection skips the prompt in both paths (low risk).

import { fetchTextOrNull } from "./api.mjs";

const STYLE_ATTR = "data-vault-handler-styles";
const SCRIPT_ATTR = "data-vault-handler-scripts";

/**
 * Per-session approval cache for handler-script injection. Keyed by vault
 * id; cleared on world reload.
 */
const sessionApprovedScripts = new Set();

/**
 * Inject handler assets for a vault without prompting. The persistent
 * `importHandlerStyles` / `importHandlerScripts` toggles are the only
 * gates; if they're on, the asset is fetched and injected. Used from
 * world ready (the GM consented before the reload) and from settings
 * save (the GM is actively in the dialog and has just acknowledged the
 * one-time warning when flipping a toggle on).
 */
export async function applyHandlerAssets(vault) {
  if (!vault?.id || !vault?.url) return;
  const cssPath = vault.handlerAssetPaths?.foundryCss || "/_handlers.foundry.css";
  const jsPath = vault.handlerAssetPaths?.foundryJs || "/_handlers.foundry.js";

  if (vault.importHandlerStyles) {
    const css = await fetchTextOrNull(vault, cssPath);
    injectStyle(vault.id, css);
  } else {
    removeStyle(vault.id);
  }
  if (vault.importHandlerScripts) {
    const js = await fetchTextOrNull(vault, jsPath);
    injectScript(vault.id, js);
    // A silent inject still primes the per-session cache — if a sync
    // re-fires shortly after with the same content, no need to prompt.
    if (js) sessionApprovedScripts.add(vault.id);
  } else {
    removeScript(vault.id);
  }
}

/**
 * Sync-time variant: same as applyHandlerAssets, but pops a per-session
 * confirmation dialog before injecting JS the first time per session.
 * The persistent toggle stays "yes, I want this enabled"; this dialog
 * adds "and yes, run this specific bundle of code right now."
 *
 * @param vault   the vault to apply assets for
 * @param opts.reason  short identifier for the prompt context, surfaced
 *                     in the dialog so the GM knows why they're being asked.
 */
export async function applyHandlerAssetsWithConfirm(vault, opts = {}) {
  if (!vault?.id || !vault?.url) return;
  const cssPath = vault.handlerAssetPaths?.foundryCss || "/_handlers.foundry.css";
  const jsPath = vault.handlerAssetPaths?.foundryJs || "/_handlers.foundry.js";

  // CSS: no prompt.
  if (vault.importHandlerStyles) {
    const css = await fetchTextOrNull(vault, cssPath);
    injectStyle(vault.id, css);
  } else {
    removeStyle(vault.id);
  }

  // JS: prompt unless already approved this session.
  if (vault.importHandlerScripts) {
    const js = await fetchTextOrNull(vault, jsPath);
    if (!js) {
      removeScript(vault.id);
      return;
    }
    if (sessionApprovedScripts.has(vault.id)) {
      injectScript(vault.id, js);
      return;
    }
    const ok = await confirmScriptInjection(vault, opts.reason || "import", js);
    if (ok) {
      sessionApprovedScripts.add(vault.id);
      injectScript(vault.id, js);
    } else {
      removeScript(vault.id);
    }
  } else {
    removeScript(vault.id);
  }
}

async function confirmScriptInjection(vault, reason, js) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) {
    // Foundry too old; fall back to a notification + skip rather than
    // silently injecting without the per-session re-confirm.
    ui.notifications?.warn(
      `Vaults | "${vault.label}" wants to inject handler scripts but DialogV2 is unavailable; skipping.`,
    );
    return false;
  }
  const sizeKb = Math.max(1, Math.round((js?.length ?? 0) / 1024));
  const reasonLabel = reason === "ready" ? game.i18n.localize("VAULTS.HandlerAssets.ReasonReady")
    : reason === "sync"  ? game.i18n.localize("VAULTS.HandlerAssets.ReasonSync")
    : reason === "settings" ? game.i18n.localize("VAULTS.HandlerAssets.ReasonSettings")
    : game.i18n.localize("VAULTS.HandlerAssets.ReasonImport");
  const body = `
    <p>${escapeText(game.i18n.format("VAULTS.HandlerAssets.SessionPromptIntro", {
      name: vault.label, size: String(sizeKb), reason: reasonLabel,
    }))}</p>
    <p><strong>${escapeText(game.i18n.localize("VAULTS.HandlerAssets.SessionPromptWarn"))}</strong></p>
    <p class="notes">${escapeText(game.i18n.localize("VAULTS.HandlerAssets.SessionPromptDecline"))}</p>`;
  return DialogV2.confirm({
    window: { title: game.i18n.localize("VAULTS.HandlerAssets.SessionPromptTitle") },
    content: body,
    yes: { label: game.i18n.localize("VAULTS.HandlerAssets.SessionPromptAccept") },
    no:  { label: game.i18n.localize("VAULTS.HandlerAssets.SessionPromptCancel") },
  });
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

/** Idempotent: repeated calls with the same vault.id replace the element. */
export function removeHandlerAssets(vaultId) {
  removeStyle(vaultId);
  removeScript(vaultId);
}

function injectStyle(vaultId, css) {
  removeStyle(vaultId);
  if (!css) return;
  const el = document.createElement("style");
  el.setAttribute(STYLE_ATTR, vaultId);
  el.textContent = css;
  document.head.appendChild(el);
}

function removeStyle(vaultId) {
  const el = document.head.querySelector(`style[${STYLE_ATTR}="${cssEscape(vaultId)}"]`);
  if (el) el.remove();
}

function injectScript(vaultId, js) {
  removeScript(vaultId);
  if (!js) return;
  const el = document.createElement("script");
  el.setAttribute(SCRIPT_ATTR, vaultId);
  el.textContent = js;
  // Append to body, not head, so the script runs after Foundry's own
  // bootstrap chain has settled.
  document.body.appendChild(el);
}

function removeScript(vaultId) {
  const el = document.body.querySelector(`script[${SCRIPT_ATTR}="${cssEscape(vaultId)}"]`);
  if (el) el.remove();
}

/** Minimal CSS.escape polyfill for the vault-id attribute selector. */
function cssEscape(s) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\\n\r]/g, "\\$&");
}
