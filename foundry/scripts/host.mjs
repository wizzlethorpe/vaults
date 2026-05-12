// Module-side `createHost()`: builds the Host object the bundled importer
// receives on every runSync call. See foundry/HOST-INTERFACE.md for the
// full contract narrative; this file is the implementation that backs
// the contract with the live module's settings + UI surfaces.

import { updateVault } from "./vaults.mjs";
import { getVaultManifest, setVaultManifest } from "./vault-manifests.mjs";

/** Current host API version. Importer bundles declare a
 *  REQUIRED_HOST_VERSION; if it's higher than this, the host refuses
 *  to run and tells the GM to update the module. */
export const API_VERSION = 1;

export function createHost() {
  return {
    API_VERSION,

    getVaultState(vaultId) { return getVaultManifest(vaultId); },
    async setVaultState(vaultId, patch) { await setVaultManifest(vaultId, patch); },

    async updateVaultEntry(vaultId, patch) { await updateVault(vaultId, patch); },

    notify(level, message) {
      if (level === "error") ui.notifications.error(message);
      else if (level === "warn") ui.notifications.warn(message);
      else ui.notifications.info(message);
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
