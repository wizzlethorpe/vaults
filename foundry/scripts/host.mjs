// Module-side `createHost()`: builds the Host object the bundled importer
// receives on every runSync call. See foundry/HOST-INTERFACE.md for the
// full contract narrative; this file is the implementation that backs
// the contract with the live module's settings + UI surfaces.

import { getVault, updateVault } from "./vaults.mjs";
import {
  getVaultManifest, setVaultManifest, removeVaultManifest,
} from "./vault-manifests.mjs";

/** Current host API version. Importer bundles declare a
 *  REQUIRED_HOST_VERSION; if it's higher than this, the host refuses
 *  to run and tells the GM to update the module. */
export const API_VERSION = 1;

export function createHost() {
  return {
    API_VERSION,

    // ── Per-vault sync state ──────────────────────────────────────────
    // Backed by the `vaultManifests` world setting. Importer reads
    // + writes opaquely; shape is the importer's concern.
    getVaultState(vaultId) { return getVaultManifest(vaultId); },
    async setVaultState(vaultId, patch) { await setVaultManifest(vaultId, patch); },
    async clearVaultState(vaultId) { await removeVaultManifest(vaultId); },

    // ── Vault registry entry ──────────────────────────────────────────
    // The vault list itself (label, url, token, role, knownRoles, …)
    // lives in the `vaults` world setting. Importer reads to get the
    // latest token (which liveness checks may have just cleared) and
    // writes when probing the manifest reveals new metadata.
    getVaultEntry(vaultId) { return getVault(vaultId); },
    async updateVaultEntry(vaultId, patch) { await updateVault(vaultId, patch); },

    // ── Auth refresh ──────────────────────────────────────────────────
    // Stub for now; phase 3 wires the Connect dialog through here so a
    // mid-sync 401 can offer re-auth instead of just failing.
    async refreshToken(_vault, _reason) { return null; },

    // ── UI affordances ────────────────────────────────────────────────
    notify(level, message) {
      if (level === "error") ui.notifications.error(message);
      else if (level === "warn") ui.notifications.warn(message);
      else ui.notifications.info(message);
    },

    progress(opts) {
      // Foundry's V13+ notifications API has progress slots; wrap them
      // so the importer doesn't need to track the slot id directly.
      const slot = ui.notifications.info(opts.title, { progress: true, permanent: true });
      const tot = opts.total ?? 0;
      return {
        update(done, total, label) {
          const t = total ?? tot;
          const pct = t > 0 ? Math.min(1, done / t) : 0;
          slot.update({ pct, message: label ?? opts.title });
        },
        done(message) { slot.update({ pct: 1, message: message ?? opts.title }); },
        fail(error) { slot.update({ pct: 1, message: `Failed: ${error.message}` }); },
      };
    },

    async confirm(opts) {
      const DialogV2 = foundry.applications?.api?.DialogV2;
      if (!DialogV2) {
        return new Promise((resolve) => {
          new Dialog({
            title: opts.title,
            content: opts.content,
            buttons: {
              yes: { label: "Yes", callback: () => resolve(true) },
              no: { label: "No", callback: () => resolve(false) },
            },
            default: opts.defaultYes ? "yes" : "no",
            close: () => resolve(false),
          }).render(true);
        });
      }
      return !!(await DialogV2.confirm({
        window: { title: opts.title },
        content: opts.content,
        yes: { default: !!opts.defaultYes },
        no: { default: !opts.defaultYes },
      }));
    },

    localize(key, args) {
      return args ? game.i18n.format(key, args) : game.i18n.localize(key);
    },
  };
}
