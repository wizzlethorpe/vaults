// Entry point: register settings, wire the journal-directory sync button.
// Connect flow is popup + postMessage (see auth.mjs) — no page-load
// callback to handle.

import { SETTINGS, get, set, registerSettings } from "./settings.mjs";
import { sync } from "./sync.mjs";
import { prepareConnect, awaitConnectMessage, disconnect, tokenInfo } from "./auth.mjs";

Hooks.once("init", () => {
  registerSettings();
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
    try {
      const info = await runConnectInDialog(u);
      if (!info) return false; // user dismissed the dialog without approving
    } catch (err) {
      ui.notifications.error(err.message || "Connect failed.");
      return false;
    }
    // First-time connect: kick off a full sync so the user sees journals
    // appear immediately rather than having to reopen the dialog and click
    // Sync. Errors here are non-fatal — the connect itself succeeded.
    runSync({ forceFull: true }).catch((err) => console.error("Vaults |", err));
    return true;
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

// Open the vault's /connect inside a Foundry DialogV2 (iframe) and wait
// for the approve postMessage. Resolves with token info on success, or
// null if the user dismissed the dialog without approving.
async function runConnectInDialog(vaultUrl) {
  const { src, vaultOrigin, state } = await prepareConnect(vaultUrl);
  const waiter = awaitConnectMessage({ vaultOrigin, state });

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) {
    waiter.cancel();
    throw new Error("Foundry V13+ required for the in-app connect dialog.");
  }

  // No sandbox — the iframe loads our own vault. With sandbox the iframe
  // ends up with a "null" origin, which breaks same-origin XHRs (Cloudflare
  // RUM beacons, etc.) and disables autofocus on form inputs.
  const content = `
    <iframe
      src="${escapeAttr(src)}"
      class="vaults-connect-iframe"
      style="width: 100%; height: 600px; border: 0; border-radius: 4px; background: var(--color-cool-5, #fff);">
    </iframe>
    <p class="notes" style="margin-top:0.5rem;">
      Sign in to your vault and click <strong>Approve</strong>. This window
      closes automatically once a token is issued.
    </p>
  `;

  const dialog = new DialogV2({
    window: { title: game.i18n.localize("VAULTS.Connect.DialogTitle") || "Connect to Vault" },
    position: { width: 640 },
    classes: ["vaults-app", "vaults-connect-dialog"],
    content,
    buttons: [{ action: "cancel", label: game.i18n.localize("VAULTS.Dialog.Cancel"), default: true }],
  });
  dialog.render({ force: true });

  // Whichever fires first wins: a vault postMessage (success) or the
  // dialog being dismissed (user cancel / close button).
  return new Promise((resolve, reject) => {
    let done = false;
    waiter.promise.then((info) => {
      if (done) return;
      done = true;
      try { dialog.close(); } catch { /* ignore */ }
      resolve(info);
    }, (err) => {
      if (done) return;
      done = true;
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
