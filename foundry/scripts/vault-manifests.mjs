// Per-vault sync-state storage. Kept separate from the `vaults` setting
// (which holds vault config) because manifest objects can be multi-MB on
// large vaults; if they lived in the per-vault entries, every config
// patch (settings dialog save, dmRole edit, handler-asset toggle) would
// re-serialize every vault's full file list to world-settings storage.
//
// Shape: a single Object setting keyed by vaultId →
//   { lastManifest: { [path]: hash }, lastImageManifest: { [path]: hash } }.
//
// One Object setting (vs N per-vault keys) keeps registration cheap. We
// pay one read of the full map per access, which is fine because access
// is once-per-sync. Writes patch the single entry for the syncing vault.

import { SETTINGS, get, set } from "./settings.mjs";

const EMPTY = { lastManifest: {}, lastImageManifest: {} };

/** Get the per-vault manifest entry, defaulting to empty maps. */
export function getVaultManifest(vaultId) {
  const all = get(SETTINGS.vaultManifests) || {};
  return all[vaultId] ? { ...EMPTY, ...all[vaultId] } : { ...EMPTY };
}

/** Patch ONE vault's manifest entry. Other vaults' entries are unchanged. */
export async function setVaultManifest(vaultId, patch) {
  const all = { ...(get(SETTINGS.vaultManifests) || {}) };
  all[vaultId] = { ...EMPTY, ...(all[vaultId] ?? {}), ...patch };
  await set(SETTINGS.vaultManifests, all);
}

/** Drop a vault's manifest entry entirely. Called on vault removal. */
export async function removeVaultManifest(vaultId) {
  const all = { ...(get(SETTINGS.vaultManifests) || {}) };
  if (!(vaultId in all)) return;
  delete all[vaultId];
  await set(SETTINGS.vaultManifests, all);
}
