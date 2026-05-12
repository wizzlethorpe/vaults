// Entry point for the wiki-shipped importer bundle. The CLI bundles this
// (plus its transitive imports) via esbuild into a single ESM file at
// `${VAULT_URL}/_foundry/importer.js`. The Foundry module fetches that
// bundle at sync time, hash-verifies it, and calls these entry points
// against a host it constructs.
//
// Phase 1 (this commit): the entry point exists, the bundle ships from
// the wiki, but the module hasn't switched over yet — it still imports
// the underlying scripts/ files locally. runSync / runRemove ignore the
// host parameter and call existing module-coupled functions directly.
//
// Phase 2 will rewrite the underlying files to pull their dependencies
// (game.documents, settings I/O, file cache, notifications, …) off the
// host instead of from Foundry globals. At that point the bundle becomes
// the actual import path and the local imports get dropped from the
// module side.
//
// See foundry/HOST-INTERFACE.md for the full contract.

import { sync } from "./sync.mjs";
import { deleteVaultJournals } from "./importer.mjs";
import { deleteVaultCache } from "./media.mjs";
import { deleteVaultInstances } from "./instance.mjs";

/** Bumped on host-contract changes the importer relies on. v0.7's
 *  contract: see HOST-INTERFACE.md. */
export const REQUIRED_HOST_VERSION = 1;

export async function runSync(_host, vault, options = {}) {
  // _host is unused for now; phase 2 wires it through the call tree.
  return sync(vault.id, options);
}

export async function runRemove(_host, vault) {
  await deleteVaultJournals(vault.id);
  await deleteVaultCache(vault.id);
  await deleteVaultInstances(vault.id);
}
