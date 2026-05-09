// Per-vault handler-asset import. Two-layer consent: a handler author opts
// its assets into Foundry import via assets.foundry.{styles,scripts} on the
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
// Per-session JS confirmation: even when the persistent toggle is on, the
// applyHandlerAssetsWithConfirm wrapper prompts the GM once per session
// before injecting JS — so a vault that ships new code between sessions
// can't run silently. CSS skips the prompt (low-risk).

import { fetchTextOrNull } from "./api.mjs";

const STYLE_ATTR = "data-vault-handler-styles";
const SCRIPT_ATTR = "data-vault-handler-scripts";

/**
 * Per-session approval cache for handler-script injection. Keyed by vault
 * id; cleared on world reload. The persistent setting records GM intent;
 * this set records that they've also accepted *this session's* fetched JS.
 */
const sessionApprovedScripts = new Set();

/**
 * Apply or refresh handler-asset injection for a single vault. Called
 * after every successful sync. No-op when neither toggle is on.
 *
 * Use applyHandlerAssetsWithConfirm() instead from interactive contexts;
 * this raw version is for paths that have already gated consent.
 */
export async function applyHandlerAssets(vault) {
  if (!vault?.id || !vault?.url) return;

  // Prefer the URL the deploy advertised in its manifest; fall back to the
  // historical well-known path so older deploys (pre-asset-advertisement)
  // still work. The fallback is fine since the path didn't change — but
  // when (not if) we move it later, the manifest will carry the new URL.
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
  } else {
    removeScript(vault.id);
  }
}

/**
 * Like applyHandlerAssets, but pops a per-session confirmation dialog
 * before injecting JS. Reused across world-ready, post-sync, and
 * settings-save callsites so the consent UI is consistent.
 *
 * @param vault   the vault to apply assets for
 * @param opts.reason  short identifier for the prompt context ("ready",
 *                    "sync", "settings"). Surfaced in the dialog title so
 *                    the GM knows why they're being asked.
 */
export async function applyHandlerAssetsWithConfirm(vault, opts = {}) {
  if (!vault?.id || !vault?.url) return;

  const cssPath = vault.handlerAssetPaths?.foundryCss || "/_handlers.foundry.css";
  const jsPath = vault.handlerAssetPaths?.foundryJs || "/_handlers.foundry.js";

  // CSS injection: no prompt, low-risk.
  if (vault.importHandlerStyles) {
    const css = await fetchTextOrNull(vault, cssPath);
    injectStyle(vault.id, css);
  } else {
    removeStyle(vault.id);
  }

  // JS injection: gated by per-session prompt unless already approved this
  // session. The persistent setting opts the vault in to ASKING; the
  // session set records that the GM said yes for THIS run's fetched JS.
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
