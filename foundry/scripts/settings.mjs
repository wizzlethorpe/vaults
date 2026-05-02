// World-scoped settings for the Vaults module.
//
// Multi-vault: the canonical state lives in a single `vaults` setting (array
// of vault entries). Legacy keys (`url`, `token`, etc) are kept registered
// so existing worlds load cleanly; on first read they're auto-migrated into
// a vaults[] entry; see migrateLegacyIfNeeded() below.

export const MODULE_ID = "vaults";

export const SETTINGS = {
  /** Array of vault entries; see VAULT_DEFAULTS for shape. */
  vaults: "vaults",

  // Legacy single-vault keys (pre-0.4). Read once at migration, never
  // written to after that. Don't reference these in new code.
  url: "url",
  token: "token",
  role: "role",
  rootFolder: "rootFolder",
  lastManifest: "lastManifest",
  lastImageManifest: "lastImageManifest",
  pendingState: "pendingState",
};

/** Default shape for a new vault entry. */
export const VAULT_DEFAULTS = {
  id: "",
  label: "",
  url: "",
  rootFolder: "Vault",
  token: "",
  role: "",
  lastManifest: {},
  lastImageManifest: {},
  pendingState: "",
};

export function registerSettings() {
  const g = game.settings;

  g.register(MODULE_ID, SETTINGS.vaults, {
    scope: "world", config: false, type: Array, default: [],
  });

  // Legacy keys; registered so existing worlds load without crashes.
  // Migrated to vaults[] on first load.
  for (const key of [SETTINGS.url, SETTINGS.token, SETTINGS.role, SETTINGS.pendingState]) {
    g.register(MODULE_ID, key, { scope: "world", config: false, type: String, default: "" });
  }
  g.register(MODULE_ID, SETTINGS.rootFolder, { scope: "world", config: false, type: String, default: "Vault" });
  g.register(MODULE_ID, SETTINGS.lastManifest, { scope: "world", config: false, type: Object, default: {} });
  g.register(MODULE_ID, SETTINGS.lastImageManifest, { scope: "world", config: false, type: Object, default: {} });
}

export const get = (k) => game.settings.get(MODULE_ID, k);
export const set = (k, v) => game.settings.set(MODULE_ID, k, v);
