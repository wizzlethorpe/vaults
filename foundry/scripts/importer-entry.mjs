// Entry point for the wiki-shipped importer bundle. The CLI bundles this
// (plus its transitive imports) via esbuild into a single ESM file at
// `${VAULT_URL}/_foundry/importer.js`. The Foundry module fetches that
// bundle at sync time, hash-verifies it, and calls these entry points
// against a host it constructs.
//
// Phase 2: bundled code talks to the module through the `host` interface
// for state I/O + registry I/O + notifications. Foundry globals (game,
// ui, JournalEntry, FilePicker, …) are still used directly since they're
// stable across V13/V14. See foundry/HOST-INTERFACE.md.
//
// Phase 3 (future) will switch the module to fetch + hash-verify + eval
// this bundle instead of importing it locally.

import { sync } from "./sync.mjs";
import { deleteVaultJournals } from "./importer.mjs";
import { deleteVaultCache } from "./media.mjs";
import { deleteVaultInstances } from "./instance.mjs";

/** Bumped on host-contract changes the importer relies on. v0.7's
 *  contract: see HOST-INTERFACE.md. */
export const REQUIRED_HOST_VERSION = 1;

export async function runSync(host, vault, options = {}) {
  return sync(host, vault, options);
}

export async function runRemove(_host, vault) {
  await deleteVaultJournals(vault.id);
  await deleteVaultCache(vault.id);
  await deleteVaultInstances(vault.id);
}
