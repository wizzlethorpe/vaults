// Vault registry. Wraps the `vaults` setting (array of entries) with a
// small CRUD API + a one-time migration from the legacy single-vault keys.

import { MODULE_ID, SETTINGS, VAULT_DEFAULTS, get, set } from "./settings.mjs";
import { setVaultManifest, removeVaultManifest, migrateInlineManifestsIfNeeded } from "./vault-manifests.mjs";

let migrated = false;

/** Run on init. Idempotent; safe to call repeatedly. */
export async function migrateLegacyIfNeeded() {
  if (migrated) return;
  migrated = true;

  // Lift any inline lastManifest/lastImageManifest off existing vault
  // entries into the separate per-vault setting (pre-0.7 layout).
  await migrateInlineManifestsIfNeeded();

  const list = get(SETTINGS.vaults) || [];
  if (list.length > 0) return; // already on the new model

  const legacyUrl = get(SETTINGS.url) || "";
  if (!legacyUrl) return; // nothing to migrate

  const id = newVaultId();
  const entry = {
    ...VAULT_DEFAULTS,
    id,
    label: deriveLabel(legacyUrl),
    url: legacyUrl,
    rootFolder: get(SETTINGS.rootFolder) || "Vault",
    token: get(SETTINGS.token) || "",
    role: get(SETTINGS.role) || "",
  };
  await set(SETTINGS.vaults, [entry]);
  // Sync state from legacy single-vault setting → per-vault entry.
  await setVaultManifest(id, {
    lastManifest: { ...(get(SETTINGS.lastManifest) || {}) },
    lastImageManifest: { ...(get(SETTINGS.lastImageManifest) || {}) },
  });
  console.info(`Vaults | migrated single-vault config to multi-vault registry: ${entry.label}`);
}

/** All registered vaults (a copy; mutate via update/remove). */
export function listVaults() {
  return [...(get(SETTINGS.vaults) || [])];
}

export function getVault(id) {
  return listVaults().find((v) => v.id === id) || null;
}

/** Create a new vault entry from `partial` and persist. Returns the entry. */
export async function addVault(partial) {
  const list = listVaults();
  const entry = {
    ...VAULT_DEFAULTS,
    ...partial,
    id: partial.id || newVaultId(),
    label: partial.label || deriveLabel(partial.url || ""),
    rootFolder: partial.rootFolder || deriveLabel(partial.url || ""),
  };
  list.push(entry);
  await set(SETTINGS.vaults, list);
  return entry;
}

/** Patch a vault by id and persist. Throws if no such vault. */
export async function updateVault(id, patch) {
  const list = listVaults();
  const idx = list.findIndex((v) => v.id === id);
  if (idx < 0) throw new Error(`Vault not found: ${id}`);
  list[idx] = { ...list[idx], ...patch };
  await set(SETTINGS.vaults, list);
  return list[idx];
}

/** Remove a vault entry by id. Caller is responsible for cleanup of journals/images.
 *  The per-vault sync state in vaultManifests is dropped here so the world
 *  doesn't accumulate orphan manifest entries after repeated add/remove cycles. */
export async function removeVault(id) {
  const list = listVaults().filter((v) => v.id !== id);
  await set(SETTINGS.vaults, list);
  await removeVaultManifest(id);
}

/** Pretty label derived from a URL host. */
export function deriveLabel(url) {
  if (!url) return "Vault";
  try { return new URL(url).host.split(".")[0] || "Vault"; }
  catch { return "Vault"; }
}

function newVaultId() {
  // 12 hex chars; enough for collision avoidance, short enough to fit in
  // file paths and journal-flag values without bloat.
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
