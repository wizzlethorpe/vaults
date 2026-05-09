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

/**
 * Migration: pre-0.7 stored lastManifest/lastImageManifest INLINE on each
 * vault entry. If we see those fields on a vault, lift them out into the
 * vaultManifests map and strip them from the vault entry. Idempotent —
 * vaults that have already been migrated have no inline fields to lift.
 *
 * Returns true if anything moved (caller can log).
 */
export async function migrateInlineManifestsIfNeeded() {
  const vaults = get(SETTINGS.vaults) || [];
  if (vaults.length === 0) return false;
  let touched = false;
  const all = { ...(get(SETTINGS.vaultManifests) || {}) };
  const cleanVaults = vaults.map((v) => {
    if (!("lastManifest" in v) && !("lastImageManifest" in v)) return v;
    touched = true;
    const inline = {
      lastManifest: v.lastManifest || {},
      lastImageManifest: v.lastImageManifest || {},
    };
    all[v.id] = { ...(all[v.id] ?? {}), ...inline };
    const { lastManifest: _a, lastImageManifest: _b, ...rest } = v;
    return rest;
  });
  if (!touched) return false;
  await set(SETTINGS.vaultManifests, all);
  await set(SETTINGS.vaults, cleanVaults);
  console.info(`Vaults | migrated inline lastManifest/lastImageManifest to per-vault settings.`);
  return true;
}
