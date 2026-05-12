// World-scoped settings for the Vaults module.

export const MODULE_ID = "vaults";

export const SETTINGS = {
  /** Array of vault entries; see VAULT_DEFAULTS for shape. Per-vault
   *  sync state (lastManifest, lastImageManifest) lives separately in
   *  `vaultManifests` so per-vault config patches don't round-trip
   *  every other vault's full file list on every save. */
  vaults: "vaults",

  /** Object keyed by vaultId → { lastManifest, lastImageManifest }. */
  vaultManifests: "vaultManifests",
};

/** Default shape for a new vault entry. lastManifest / lastImageManifest are
 *  NOT here — they live in the separate `vaultManifests` setting (see
 *  vault-manifests.mjs). Keeping the entry skinny means a per-vault config
 *  edit doesn't re-serialize every vault's sync state. */
export const VAULT_DEFAULTS = {
  id: "",
  label: "",
  url: "",
  rootFolder: "Vault",
  token: "",
  role: "",
  // Set when the deploy is single-role (no auth middleware, no /_batch
  // endpoints). Refreshed from the manifest's auth.required flag on every
  // sync, so a public→private flip self-corrects on the next manifest fetch.
  public: false,
  // Role order (lowest → highest) reported by the deploy's manifest. Cached
  // on the vault so the per-vault settings dialog can populate the dmRole
  // dropdown without re-fetching the manifest.
  knownRoles: [],
  // Pages with a role rank below dmRole get default ownership "observer"
  // (player-visible) on import; pages at dmRole or higher stay GM-only.
  // Empty string = no gating; everything imports as GM-only.
  dmRole: "",
  // Per-vault opt-in to import handler-shipped CSS/JS from the deployed
  // wiki. Both default false: a handler author has to opt in by setting
  // `assets.targets.foundry.{styles,scripts} = true` AND the GM has to flip the
  // matching toggle here. CSS at worst restyles a journal sheet; JS runs
  // in Foundry's global scope and can interact with `game`, `canvas`,
  // hooks, and document data — treat both flips as "I trust this vault's
  // handler authors with my world".
  importHandlerStyles: false,
  importHandlerScripts: false,
  // Asset URLs the deploy advertises in its manifest's `assets.foundry`
  // block. Cached here so applyHandlerAssetsWithConfirm fetches via the canonical
  // path instead of guessing /_handlers.foundry.{js,css}. Empty / null
  // fields fall back to the well-known names for older deploys.
  handlerAssetPaths: { foundryJs: null, foundryCss: null },
  // SHA-256 of the wiki's `_foundry/importer.js` bundle the GM last
  // approved for this vault. The loader compares this on every sync;
  // empty string = no trust granted yet (first sync prompts). A mismatch
  // re-prompts with old → new hash.
  trustedImporterHash: "",
};

export function registerSettings() {
  const g = game.settings;
  g.register(MODULE_ID, SETTINGS.vaults, {
    scope: "world", config: false, type: Array, default: [],
  });
  g.register(MODULE_ID, SETTINGS.vaultManifests, {
    scope: "world", config: false, type: Object, default: {},
  });
}

export const get = (k) => game.settings.get(MODULE_ID, k);
export const set = (k, v) => game.settings.set(MODULE_ID, k, v);
