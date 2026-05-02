// Entry point: register settings, run one-time migration, wire the
// journal-directory Sync Vault button.

import { registerSettings } from "./settings.mjs";
import { listVaults, getVault, addVault, updateVault, removeVault, deriveLabel, migrateLegacyIfNeeded } from "./vaults.mjs";
import { sync } from "./sync.mjs";
import { prepareConnect, awaitConnectMessage, disconnect, tokenInfo } from "./auth.mjs";
import { deleteVaultJournals } from "./importer.mjs";
import { deleteVaultCache } from "./media.mjs";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", async () => {
  await migrateLegacyIfNeeded();
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
  const connected = !!v.token && info?.expiresAt && info.expiresAt > new Date();
  const status = connected
    ? `<span class="vaults-row-role">${escapeText(v.role || info?.role || "?")}</span>`
    : `<span class="vaults-row-disconnected">${escapeText(game.i18n.localize("VAULTS.Dialog.NotConnected"))}</span>`;

  const primary = connected
    ? `<button type="button" class="vaults-row-primary" data-vaults-action="sync" data-vaults-id="${escapeAttr(v.id)}">
         <i class="fa-solid fa-rotate"></i> ${escapeText(game.i18n.localize("VAULTS.Dialog.Sync"))}
       </button>`
    : `<button type="button" class="vaults-row-primary" data-vaults-action="connect" data-vaults-id="${escapeAttr(v.id)}">
         <i class="fa-solid fa-link"></i> ${escapeText(game.i18n.localize("VAULTS.Dialog.Connect"))}
       </button>`;

  const secondary = connected
    ? `<button type="button" data-vaults-action="force-sync" data-vaults-id="${escapeAttr(v.id)}" title="${escapeAttr(game.i18n.localize("VAULTS.Dialog.ForceSync"))}">
         <i class="fa-solid fa-arrows-rotate"></i>
       </button>
       <button type="button" data-vaults-action="disconnect" data-vaults-id="${escapeAttr(v.id)}" title="${escapeAttr(game.i18n.localize("VAULTS.Dialog.Disconnect"))}">
         <i class="fa-solid fa-link-slash"></i>
       </button>`
    : "";

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
        const entry = await addVault({ url, label: deriveLabel(url) });
        await openConnectDialog(entry.id);
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
      <p class="notes">${escapeText(game.i18n.localize("VAULTS.Dialog.RemoveHint"))}</p>
    </div>`;

  await DialogV2.wait({
    window: { title: game.i18n.format("VAULTS.Dialog.SettingsTitle", { name: v.label }) },
    position: { width: 480 },
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
          if (!patch.url) {
            ui.notifications.warn(game.i18n.localize("VAULTS.Dialog.UrlRequired"));
            return false;
          }
          await updateVault(vaultId, patch);
          return true;
        },
      },
      {
        action: "remove", label: game.i18n.localize("VAULTS.Dialog.Remove"),
        callback: async () => {
          const ok = await confirmRemoveVault(v);
          if (!ok) return false;
          await deleteVaultJournals(vaultId);
          await deleteVaultCache(vaultId);
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

// ── Connect dialog (iframe-based) ─────────────────────────────────────────

async function openConnectDialog(vaultId) {
  const v = getVault(vaultId);
  if (!v?.url) {
    ui.notifications.error("Vault URL is not set.");
    return null;
  }

  const { src, vaultOrigin, state } = await prepareConnect(v);
  const waiter = awaitConnectMessage({ vault: v, vaultOrigin, state });

  const DialogV2 = foundry.applications.api.DialogV2;
  const content = `
    <iframe
      src="${escapeAttr(src)}"
      class="vaults-connect-iframe"
      style="width: 100%; height: 600px; border: 0; border-radius: 4px; background: var(--color-cool-5, #fff);">
    </iframe>
    <p class="notes" style="margin-top:0.5rem;">
      ${escapeText(game.i18n.localize("VAULTS.Connect.IframeHint"))}
    </p>`;

  const dialog = new DialogV2({
    window: { title: game.i18n.format("VAULTS.Connect.DialogTitleNamed", { name: v.label }) },
    position: { width: 640 },
    classes: ["vaults-app", "vaults-connect-dialog"],
    content,
    buttons: [{ action: "cancel", label: game.i18n.localize("VAULTS.Dialog.Cancel"), default: true }],
  });
  dialog.render({ force: true });

  return new Promise((resolve, reject) => {
    let done = false;
    waiter.promise.then(async (info) => {
      if (done) return; done = true;
      try { await dialog.close(); } catch { /* ignore */ }
      resolve(info);
    }, (err) => {
      if (done) return; done = true;
      try { dialog.close(); } catch { /* ignore */ }
      reject(err);
    });
    Hooks.once("closeDialogV2", (d) => {
      if (d !== dialog || done) return;
      done = true;
      waiter.cancel();
      resolve(null);
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeAttr(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function escapeText(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

// Expose for macros / debugging.
globalThis.Vaults = { sync, listVaults, getVault, openVaultsDialog };
