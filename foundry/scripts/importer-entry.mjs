// Entry point for the wiki-shipped importer bundle. The CLI bundles this
// + its transitive imports into `${VAULT_URL}/_foundry/importer.js`; the
// Foundry module fetches, hash-verifies, and evaluates it at sync time.
// See ./host.mjs for the host shape these entry points receive.

import { sync } from "./sync.mjs";
import { deleteVaultCache } from "./media.mjs";
import { deleteVaultPacks } from "./packs.mjs";

/** Bumped on host-contract changes the importer relies on. */
export const REQUIRED_HOST_VERSION = 1;

export async function runSync(host, vault, options = {}) {
  return sync(host, vault, options);
}

export async function runRemove(_host, vault) {
  await deleteVaultPacks(vault.id);
  await deleteVaultCache(vault.id);
}
