// Entry point: register settings, run one-time migration, wire the
// journal-directory Sync Vault button.

import { registerSettings } from "./settings.mjs";
import { listVaults, getVault, addVault, updateVault, removeVault, migrateLegacyIfNeeded } from "./vaults.mjs";
import { applyHandlerAssetsWithConfirm, removeHandlerAssets } from "./handler-assets.mjs";
import { sync } from "./sync.mjs";
import { fetchManifest } from "./api.mjs";
import { disconnect, tokenInfo } from "./auth.mjs";
import { deleteVaultJournals } from "./importer.mjs";
import { deleteVaultCache } from "./media.mjs";
import { deleteVaultInstances } from "./instance.mjs";
import { escapeAttr, escapeHtml as escapeText } from "./util.mjs";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", async () => {
  await migrateLegacyIfNeeded();
  // Handler-asset re-application is deferred past `ready` and run
  // fire-and-forget so a slow / offline vault doesn't stall world boot.
  // The setTimeout(0) yields to the event loop so the world's render hooks
  // finish first; CSS injection then takes effect immediately. JS imports
  // additionally surface a per-session confirmation dialog (see
  // applyHandlerAssetsWithConfirm) so the GM re-acknowledges any new code
  // on every reload — the persistent toggle records intent, but a vault
  // updating its handler bundle between sessions still gets fresh consent.
  setTimeout(() => {
    listVaults().forEach((v) => {
      applyHandlerAssetsWithConfirm(v, { reason: "ready" }).catch((err) =>
        console.warn(`Vaults | handler-asset import failed for ${v.label}:`, err));
    });
  }, 0);
});

Hooks.on("renderJournalDirectory", (_app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".vaults-button")) return;

  const button = document.createElement("button");
  button.className = "vaults-button";
  button.type = "button";
  button.innerHTML = `<i class="fa-solid fa-vault"></i> ${game.i18n.localize("VAULTS.ButtonTitle")}`;
  button.addEventListener("click", (e) => { e.preventDefault(); openVaultsDialog(); });

  const row = document.createElement("div");
  row.className = "vaults-button-row";
  row.appendChild(button);

  const host = root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root;
  host.after(row);
});

// ── Vault list dialog ──────────────────────────────────────────────────────

async function openVaultsDialog() {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return ui.notifications.error("Foundry V13+ required.");

  const dialog = new DialogV2({
    window: { title: game.i18n.localize("VAULTS.Dialog.Title") },
    position: { width: 540 },
    classes: ["vaults-app", "vaults-list-dialog"],
    content: renderVaultList(),
    buttons: [{ action: "close", label: game.i18n.localize("VAULTS.Dialog.Close"), default: true }],
  });
  await dialog.render({ force: true });
  attachListHandlers(dialog);
}

function renderVaultList() {
  const vaults = listVaults();
  if (vaults.length === 0) {
    return `
      <div class="vaults-list">
        <p class="vaults-empty">${escapeText(game.i18n.localize("VAULTS.Dialog.Empty"))}</p>
        <div class="vaults-add">
          <button type="button" class="vaults-add-btn" data-vaults-action="add">
            <i class="fa-solid fa-plus"></i> ${escapeText(game.i18n.localize("VAULTS.Dialog.AddVault"))}
          </button>
        </div>
      </div>`;
  }
  return `
    <div class="vaults-list">
      ${vaults.map(renderVaultRow).join("")}
      <div class="vaults-add">
        <button type="button" class="vaults-add-btn" data-vaults-action="add">
          <i class="fa-solid fa-plus"></i> ${escapeText(game.i18n.localize("VAULTS.Dialog.AddVault"))}
        </button>
      </div>
    </div>`;
}

function renderVaultRow(v) {
  const info = tokenInfo(v.token);
  // Token-bound role wins; otherwise the deploy serves public-tier content
  // to anyone, so we show "public" rather than the misleading "(not
  // connected)" — sync still works without a token.
  const tokenOk = !!v.token && info?.expiresAt && info.expiresAt > new Date();
  const roleLabel = tokenOk
    ? (v.role || info?.role || "?")
    : game.i18n.localize("VAULTS.Dialog.Public");
  const status = `<span class="vaults-row-role">${escapeText(roleLabel)}</span>`;

  // Sync is always offered: public tier is reachable on every deploy. The
  // user explicitly opts in to elevation by clicking Connect, which is only
  // meaningful for multi-role deploys (single-role has no /connect endpoint).
  const primary = `<button type="button" class="vaults-row-primary" data-vaults-action="sync" data-vaults-id="${escapeAttr(v.id)}">
       <i class="fa-solid fa-rotate"></i> ${escapeText(game.i18n.localize("VAULTS.Dialog.Sync"))}
     </button>`;

  const canConnect = !v.public;
  const connectBtn = (canConnect && !tokenOk)
    ? `<button type="button" data-vaults-action="connect" data-vaults-id="${escapeAttr(v.id)}" title="${escapeAttr(game.i18n.localize("VAULTS.Dialog.Connect"))}">
         <i class="fa-solid fa-right-to-bracket"></i>
       </button>`
    : "";
  const disconnectBtn = tokenOk
    ? `<button type="button" data-vaults-action="disconnect" data-vaults-id="${escapeAttr(v.id)}" title="${escapeAttr(game.i18n.localize("VAULTS.Dialog.Disconnect"))}">
         <i class="fa-solid fa-right-from-bracket"></i>
       </button>`
    : "";

  const secondary = `<button type="button" data-vaults-action="force-sync" data-vaults-id="${escapeAttr(v.id)}" title="${escapeAttr(game.i18n.localize("VAULTS.Dialog.ForceSync"))}">
       <i class="fa-solid fa-arrows-rotate"></i>
     </button>
     ${connectBtn}
     ${disconnectBtn}`;

  return `
    <div class="vaults-row" data-vaults-id="${escapeAttr(v.id)}">
      <div class="vaults-row-meta">
        <div class="vaults-row-label">${escapeText(v.label)} ${status}</div>
        <div class="vaults-row-url">${escapeText(v.url)}</div>
      </div>
      <div class="vaults-row-actions">
        ${primary}
        ${secondary}
        <button type="button" data-vaults-action="settings" data-vaults-id="${escapeAttr(v.id)}" title="${escapeAttr(game.i18n.localize("VAULTS.Dialog.Settings"))}">
          <i class="fa-solid fa-gear"></i>
        </button>
      </div>
    </div>`;
}

function attachListHandlers(dialog) {
  const root = dialog.element;
  if (!root) return;
  for (const btn of root.querySelectorAll("[data-vaults-action]")) {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const action = btn.dataset.vaultsAction;
      const vaultId = btn.dataset.vaultsId;
      await handleListAction(action, vaultId, dialog);
    });
  }
}

async function handleListAction(action, vaultId, dialog) {
  switch (action) {
    case "add": {
      await dialog.close();
      const url = await openAddVaultDialog();
      if (url) {
        const entry = await addVault({ url });
        // Probe the manifest so the settings dialog opens with the dmRole
        // picker already populated (otherwise the picker is hidden until
        // after the first sync, which is a worse first-run experience).
        // Captures `public` + `knownRoles` + the deploy's display name.
        const probe = await probeManifest(entry);
        const patch = { public: probe.public, knownRoles: probe.knownRoles };
        // Prefer the deploy's vault_name over the host-derived slug so
        // "Southaven" wins over "southaven". Only applied at add-time —
        // later edits in the settings dialog are user intent and survive
        // future syncs.
        if (probe.name) {
          patch.label = probe.name;
          patch.rootFolder = probe.name;
        }
        await updateVault(entry.id, patch);
        // Drop the user straight into settings so they can review/edit
        // before the first sync.
        await openSettingsDialog(entry.id);
      }
      await openVaultsDialog();
      return;
    }

    case "connect":
      await dialog.close();
      await openConnectDialog(vaultId);
      await openVaultsDialog();
      return;

    case "sync":
    case "force-sync":
      await dialog.close();
      try { await sync(vaultId, { forceFull: action === "force-sync" }); }
      catch (err) {
        console.error("Vaults |", err);
        ui.notifications.error(game.i18n.format("VAULTS.Sync.Error", { message: err.message }));
      }
      await openVaultsDialog();
      return;

    case "disconnect":
      await disconnect(vaultId);
      ui.notifications.info(game.i18n.localize("VAULTS.Dialog.Disconnected"));
      await reRenderList(dialog);
      return;

    case "settings":
      await dialog.close();
      await openSettingsDialog(vaultId);
      await openVaultsDialog();
      return;
  }
}

/**
 * One-shot manifest fetch used at add-time to seed the deploy-derived fields
 * on a fresh vault entry: `public` (drives API-fallback choice + whether the
 * Connect button appears), `knownRoles` (populates the dmRole picker in
 * settings), and `name` (the vault's display name, used as the default
 * label + root folder so the user sees something readable instead of a
 * host-derived slug). Network errors / older deploys without these fields
 * fall back to defaults; the next successful sync overwrites them.
 */
async function probeManifest(vault) {
  try {
    const m = await fetchManifest(vault);
    return {
      public: m?.auth?.required === false,
      knownRoles: Array.isArray(m?.auth?.roles) ? m.auth.roles : [],
      name: typeof m?.name === "string" ? m.name.trim() : "",
    };
  } catch (err) {
    console.warn("Vaults | probe failed; assuming protected vault, no known roles:", err);
    return { public: false, knownRoles: [], name: "" };
  }
}

async function reRenderList(dialog) {
  const root = dialog.element?.querySelector(".dialog-content, .window-content");
  if (!root) return;
  // Replace just the vault list block; leaves the surrounding action bar
  // (Close button) intact.
  const listEl = root.querySelector(".vaults-list");
  if (listEl) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderVaultList();
    listEl.replaceWith(wrapper.firstElementChild);
    attachListHandlers(dialog);
  }
}

// ── Add vault sub-dialog ───────────────────────────────────────────────────

function openAddVaultDialog() {
  const DialogV2 = foundry.applications.api.DialogV2;
  return new Promise((resolve) => {
    const content = `
      <div class="vaults-form">
        <div class="form-group">
          <label for="vaults-new-url">${escapeText(game.i18n.localize("VAULTS.Dialog.UrlLabel"))}</label>
          <input id="vaults-new-url" type="url"
                 placeholder="${escapeAttr(game.i18n.localize("VAULTS.Dialog.UrlPlaceholder"))}">
        </div>
      </div>`;
    DialogV2.wait({
      window: { title: game.i18n.localize("VAULTS.Dialog.AddVaultTitle") },
      position: { width: 480 },
      classes: ["vaults-app"],
      content,
      buttons: [
        {
          action: "add", label: game.i18n.localize("VAULTS.Dialog.AddAndConnect"), default: true,
          callback: (_e, _b, dlg) => {
            const root = dlg?.element ?? dlg;
            const url = (root.querySelector("#vaults-new-url")?.value || "").trim().replace(/\/+$/, "");
            if (!url) {
              ui.notifications.warn(game.i18n.localize("VAULTS.Dialog.UrlRequired"));
              return false;
            }
            resolve(url);
            return true;
          },
        },
        { action: "cancel", label: game.i18n.localize("VAULTS.Dialog.Cancel") },
      ],
    }).then((result) => {
      if (result !== "add") resolve(null);
    });
  });
}

// ── Settings sub-dialog ────────────────────────────────────────────────────

async function openSettingsDialog(vaultId) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const v = getVault(vaultId);
  if (!v) return;

  // dmRole picker is only meaningful when we know the deploy's role list.
  // Empty knownRoles (manifest never fetched yet, or pre-roles deploy) →
  // skip the field; the user sees it after their first sync.
  const dmRoleField = (v.knownRoles?.length > 0)
    ? `<div class="form-group">
         <label>${escapeText(game.i18n.localize("VAULTS.Dialog.DmRoleLabel"))}</label>
         <select id="vaults-edit-dmrole">
           <option value="">${escapeText(game.i18n.localize("VAULTS.Dialog.DmRoleNone"))}</option>
           ${v.knownRoles.map((r) =>
             `<option value="${escapeAttr(r)}"${r === v.dmRole ? " selected" : ""}>${escapeText(r)}</option>`
           ).join("")}
         </select>
         <p class="notes">${escapeText(game.i18n.localize("VAULTS.Dialog.DmRoleHint"))}</p>
       </div>`
    : "";

  // Handler-asset import is a separate trust gate: handler authors must opt
  // their assets in via assets.targets.foundry.{styles,scripts}, and the GM must
  // tick the matching box here. Defaults off; flipping on triggers a
  // confirmation dialog (handled in the save callback).
  const handlerAssetsField = `
    <div class="form-group">
      <label>${escapeText(game.i18n.localize("VAULTS.Dialog.HandlerAssetsLabel"))}</label>
      <div>
        <label class="checkbox" style="display:block; font-weight:normal;">
          <input id="vaults-edit-import-styles" type="checkbox"${v.importHandlerStyles ? " checked" : ""}>
          ${escapeText(game.i18n.localize("VAULTS.Dialog.ImportHandlerStyles"))}
        </label>
        <label class="checkbox" style="display:block; font-weight:normal;">
          <input id="vaults-edit-import-scripts" type="checkbox"${v.importHandlerScripts ? " checked" : ""}>
          ${escapeText(game.i18n.localize("VAULTS.Dialog.ImportHandlerScripts"))}
        </label>
      </div>
      <p class="notes">${escapeText(game.i18n.localize("VAULTS.Dialog.HandlerAssetsHint"))}</p>
    </div>`;

  const content = `
    <div class="vaults-form">
      <div class="form-group">
        <label>${escapeText(game.i18n.localize("VAULTS.Dialog.LabelLabel"))}</label>
        <input id="vaults-edit-label" type="text" value="${escapeAttr(v.label)}">
      </div>
      <div class="form-group">
        <label>${escapeText(game.i18n.localize("VAULTS.Dialog.UrlLabel"))}</label>
        <input id="vaults-edit-url" type="url" value="${escapeAttr(v.url)}">
      </div>
      <div class="form-group">
        <label>${escapeText(game.i18n.localize("VAULTS.Dialog.RootFolderLabel"))}</label>
        <input id="vaults-edit-root" type="text" value="${escapeAttr(v.rootFolder)}">
      </div>
      ${dmRoleField}
      ${handlerAssetsField}
      <p class="notes">${escapeText(game.i18n.localize("VAULTS.Dialog.RemoveHint"))}</p>
    </div>`;

  await DialogV2.wait({
    window: { title: game.i18n.format("VAULTS.Dialog.SettingsTitle", { name: v.label }) },
    position: { width: 720 },
    classes: ["vaults-app"],
    content,
    buttons: [
      {
        action: "save", label: game.i18n.localize("VAULTS.Dialog.Save"), default: true,
        callback: async (_e, _b, dlg) => {
          const root = dlg?.element ?? dlg;
          const patch = {
            label: (root.querySelector("#vaults-edit-label")?.value || "").trim() || v.label,
            url: (root.querySelector("#vaults-edit-url")?.value || "").trim().replace(/\/+$/, ""),
            rootFolder: (root.querySelector("#vaults-edit-root")?.value || "").trim() || v.rootFolder,
          };
          // dmRole only exists in the form when knownRoles is populated; the
          // ?? guard keeps the field absent (no patch) on first-add saves.
          const dmRoleEl = root.querySelector("#vaults-edit-dmrole");
          if (dmRoleEl) patch.dmRole = dmRoleEl.value;

          const wantStyles = !!root.querySelector("#vaults-edit-import-styles")?.checked;
          const wantScripts = !!root.querySelector("#vaults-edit-import-scripts")?.checked;
          // Only require confirmation when transitioning OFF → ON. Flipping
          // either OFF or leaving ON unchanged is a no-op for trust.
          const flippingOnStyles = wantStyles && !v.importHandlerStyles;
          const flippingOnScripts = wantScripts && !v.importHandlerScripts;
          if (flippingOnStyles || flippingOnScripts) {
            const ok = await confirmHandlerAssetImport({
              vault: v, styles: flippingOnStyles, scripts: flippingOnScripts,
            });
            if (!ok) return false;
          }
          patch.importHandlerStyles = wantStyles;
          patch.importHandlerScripts = wantScripts;

          if (!patch.url) {
            ui.notifications.warn(game.i18n.localize("VAULTS.Dialog.UrlRequired"));
            return false;
          }
          await updateVault(vaultId, patch);
          // Reflect handler-asset toggle changes immediately. A turn-on
          // fetches + injects; a turn-off removes the previously-injected
          // <style>/<script>; an idempotent re-save just refreshes content.
          if (patch.importHandlerStyles !== v.importHandlerStyles
              || patch.importHandlerScripts !== v.importHandlerScripts) {
            await applyHandlerAssetsWithConfirm(getVault(vaultId), { reason: "settings" })
              .catch((err) => console.warn(`Vaults | handler-asset refresh failed:`, err));
          }
          return true;
        },
      },
      {
        action: "remove", label: game.i18n.localize("VAULTS.Dialog.Remove"),
        callback: async () => {
          const ok = await confirmRemoveVault(v);
          if (!ok) return false;
          await deleteVaultJournals(vaultId);
          await deleteVaultInstances(v);
          await deleteVaultCache(vaultId);
          // Drop any injected handler-asset elements for this vault before
          // the registry entry goes away. JS already-running effects (event
          // handlers, hooks attached at execution time) survive until the
          // GM reloads the world; CSS removal is immediate.
          removeHandlerAssets(vaultId);
          await removeVault(vaultId);
          ui.notifications.info(game.i18n.format("VAULTS.Dialog.Removed", { name: v.label }));
          return true;
        },
      },
      { action: "cancel", label: game.i18n.localize("VAULTS.Dialog.Cancel") },
    ],
  });
}

async function confirmRemoveVault(v) {
  const DialogV2 = foundry.applications.api.DialogV2;
  return DialogV2.confirm({
    window: { title: game.i18n.localize("VAULTS.Dialog.RemoveConfirmTitle") },
    content: `<p>${escapeText(game.i18n.format("VAULTS.Dialog.RemoveConfirmBody", { name: v.label }))}</p>`,
  });
}

/**
 * Warning dialog shown the first time a GM enables handler-asset import for
 * a vault. Custom CSS at worst restyles a journal sheet (low risk); custom
 * JS runs in Foundry's global scope and can interact with `game`, `canvas`,
 * hooks, and document data — that needs an eyes-open consent.
 *
 * Returns true if the GM accepts (proceed with the toggle); false to roll
 * the form's checkbox state back to the unchecked baseline.
 */
async function confirmHandlerAssetImport({ vault, styles, scripts }) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const lines = [];
  if (styles) lines.push(`<li>${escapeText(game.i18n.localize("VAULTS.HandlerAssets.WarnStyles"))}</li>`);
  if (scripts) lines.push(`<li><strong>${escapeText(game.i18n.localize("VAULTS.HandlerAssets.WarnScripts"))}</strong></li>`);
  const body = `
    <p>${escapeText(game.i18n.format("VAULTS.HandlerAssets.WarnIntro", { name: vault.label }))}</p>
    <ul>${lines.join("")}</ul>
    <p>${escapeText(game.i18n.localize("VAULTS.HandlerAssets.WarnTrust"))}</p>
    <p class="notes">${escapeText(game.i18n.localize("VAULTS.HandlerAssets.WarnReversible"))}</p>`;
  return DialogV2.confirm({
    window: { title: game.i18n.localize("VAULTS.HandlerAssets.WarnTitle") },
    content: body,
    yes: { label: game.i18n.localize("VAULTS.HandlerAssets.WarnAccept") },
    no:  { label: game.i18n.localize("VAULTS.HandlerAssets.WarnCancel") },
  });
}

// ── Connect dialog (paste-flow) ───────────────────────────────────────────
// "Open in browser → sign in → copy → paste here." Same shape as the
// GitHub CLI device flow. Replaces the previous iframe-based approach
// because Patreon refuses iframe embedding (X-Frame-Options) and partitioned
// cookies broke the round-trip in many browsers.

async function openConnectDialog(vaultId) {
  const v = getVault(vaultId);
  if (!v?.url) {
    ui.notifications.error("Vault URL is not set.");
    return null;
  }

  const connectUrl = new URL("/connect", v.url);
  connectUrl.searchParams.set("app", "Foundry VTT");
  connectUrl.searchParams.set("delivery", "copy");

  const DialogV2 = foundry.applications.api.DialogV2;
  const content = `
    <div class="vaults-paste-flow">
      <ol class="vaults-paste-steps">
        <li>
          <strong>${escapeText(game.i18n.localize("VAULTS.Connect.StepOpen"))}</strong>
          <a href="${escapeAttr(connectUrl.toString())}" target="_blank" rel="noopener noreferrer"
             class="vaults-open-link">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
            ${escapeText(game.i18n.localize("VAULTS.Connect.OpenButton"))}
          </a>
        </li>
        <li>
          <strong>${escapeText(game.i18n.localize("VAULTS.Connect.StepSignIn"))}</strong>
        </li>
        <li>
          <strong>${escapeText(game.i18n.localize("VAULTS.Connect.StepPaste"))}</strong>
          <textarea id="vaults-token-input" rows="4"
                    placeholder="${escapeAttr(game.i18n.localize("VAULTS.Connect.PastePlaceholder"))}"
                    class="vaults-token-input"></textarea>
          <p class="vaults-paste-error" id="vaults-paste-error" hidden></p>
        </li>
      </ol>
    </div>`;

  return new Promise((resolve) => {
    DialogV2.wait({
      window: { title: game.i18n.format("VAULTS.Connect.DialogTitleNamed", { name: v.label }) },
      position: { width: 480 },
      classes: ["vaults-app", "vaults-connect-dialog"],
      content,
      buttons: [
        {
          action: "save",
          label: game.i18n.localize("VAULTS.Connect.SaveButton"),
          default: true,
          callback: async (_e, _b, dlg) => {
            const root = dlg?.element ?? dlg;
            const ta = root.querySelector("#vaults-token-input");
            const errEl = root.querySelector("#vaults-paste-error");
            const token = (ta?.value || "").trim();
            const info = tokenInfo(token);
            const showError = (key) => {
              if (errEl) {
                errEl.textContent = game.i18n.localize(key);
                errEl.hidden = false;
              }
            };
            if (!info || !info.role) { showError("VAULTS.Connect.PasteInvalid"); return false; }
            if (!info.expiresAt) { showError("VAULTS.Connect.PasteInvalid"); return false; }
            if (info.expiresAt <= new Date()) { showError("VAULTS.Connect.PasteExpired"); return false; }
            await updateVault(vaultId, { token, role: info.role });
            ui.notifications.info(game.i18n.format("VAULTS.Connect.Success", { role: info.role }));
            resolve(info);
            return true;
          },
        },
        {
          action: "cancel",
          label: game.i18n.localize("VAULTS.Dialog.Cancel"),
          callback: () => { resolve(null); return true; },
        },
      ],
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Expose for macros / debugging.
globalThis.Vaults = { sync, listVaults, getVault, openVaultsDialog };
