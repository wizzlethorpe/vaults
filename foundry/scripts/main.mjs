// Entry point: register settings, wire the journal-directory sync button,
// catch /connect callbacks on every page load.

import { MODULE_ID, SETTINGS, get, set, registerSettings } from "./settings.mjs";
import { sync } from "./sync.mjs";
import { startConnect, handleCallback, disconnect, tokenInfo } from "./auth.mjs";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", async () => {
  await handleCallback();
});

Hooks.on("renderJournalDirectory", (_app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".vaults-button")) return;

  const button = document.createElement("button");
  button.className = "vaults-button";
  button.type = "button";
  button.innerHTML = `<i class="fa-solid fa-vault"></i> ${game.i18n.localize("VAULTS.ButtonTitle")}`;
  button.addEventListener("click", (e) => { e.preventDefault(); openSyncDialog(); });

  const row = document.createElement("div");
  row.className = "vaults-button-row";
  row.appendChild(button);

  const host = root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root;
  host.after(row);
});

async function openSyncDialog() {
  const url = get(SETTINGS.url);
  const token = get(SETTINGS.token);
  const role = get(SETTINGS.role);
  const info = tokenInfo(token);
  const isConnected = !!token && info?.expiresAt && info.expiresAt > new Date();

  const status = isConnected
    ? game.i18n.format("VAULTS.Dialog.Status.Connected", { url, role: role || info?.role || "?" })
    : url
      ? game.i18n.localize("VAULTS.Dialog.Status.NotConnected")
      : game.i18n.localize("VAULTS.Dialog.Status.NoUrl");

  const body = `
    <div class="vaults-dialog">
      <div class="form-group">
        <label for="vaults-url-input">${game.i18n.localize("VAULTS.Dialog.UrlLabel")}</label>
        <input id="vaults-url-input" type="url"
               placeholder="${game.i18n.localize("VAULTS.Dialog.UrlPlaceholder")}"
               value="${escapeAttr(url)}">
      </div>
      <p class="notes vaults-status">${escapeText(status)}</p>
    </div>
  `;

  const onConnect = async (root) => {
    const inputEl = root.querySelector("#vaults-url-input");
    const u = (inputEl?.value || "").trim().replace(/\/+$/, "");
    if (!u) {
      ui.notifications.warn("Enter a vault URL first.");
      return false;
    }
    if (u !== url) await set(SETTINGS.url, u);
    ui.notifications.info(game.i18n.localize("VAULTS.Connect.Started"));
    await startConnect(u);
    return true; // page redirects; nothing more to do
  };

  const DialogV2 = foundry.applications?.api?.DialogV2;
  const buttons = [];
  if (!isConnected) {
    buttons.push({
      action: "connect", label: game.i18n.localize("VAULTS.Dialog.Connect"), default: true,
      callback: (_e, _b, dialog) => onConnect(dialog?.element ?? dialog),
    });
  } else {
    buttons.push({
      action: "sync", label: game.i18n.localize("VAULTS.Dialog.Sync"), default: true,
      callback: () => runSync({ forceFull: false }),
    });
    buttons.push({
      action: "full", label: game.i18n.localize("VAULTS.Dialog.Reset"),
      callback: () => runSync({ forceFull: true }),
    });
    buttons.push({
      action: "disconnect", label: "Disconnect",
      callback: () => disconnect(),
    });
  }
  buttons.push({ action: "cancel", label: game.i18n.localize("VAULTS.Dialog.Cancel") });

  if (DialogV2) {
    await DialogV2.wait({
      window: { title: game.i18n.localize("VAULTS.Dialog.Title") },
      position: { width: 480 },
      classes: ["vaults-app"],
      content: body,
      buttons,
    });
  } else {
    new Dialog({
      title: game.i18n.localize("VAULTS.Dialog.Title"),
      content: body,
      buttons: Object.fromEntries(buttons.map((b) => [b.action, { label: b.label, callback: b.callback }])),
      default: buttons[0].action,
    }, { width: 480, classes: ["dialog", "vaults-app"] }).render(true);
  }
}

async function runSync(opts) {
  try {
    await sync(opts);
  } catch (err) {
    console.error("Vaults |", err);
    ui.notifications.error(game.i18n.format("VAULTS.Sync.Error", { message: err.message }));
  }
}

function escapeAttr(s) { return String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function escapeText(s) { return String(s).replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

// Expose for macros/debugging.
globalThis.Vaults = { sync, startConnect, disconnect };
