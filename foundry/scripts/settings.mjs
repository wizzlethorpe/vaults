export const MODULE_ID = "vaults";

export const SETTINGS = {
  /** Base URL of the deployed vault, e.g. https://my-vault.pages.dev */
  url: "url",
  /** Bearer token (signed JWT-ish, format: role.expiry.HMAC). Set by Connect. */
  token: "token",
  /** Display label for the role we're connected as (purely for UI). */
  role: "role",
  /** Top-level Foundry folder name. */
  rootFolder: "rootFolder",
  /** Last seen { path → hash } map from the vault's _manifest.json. */
  lastManifest: "lastManifest",
  /** Last-downloaded { imagePath → hash } so image sync is incremental. */
  lastImageManifest: "lastImageManifest",
  /** Random nonce used to round-trip state through the /connect flow. */
  pendingState: "pendingState",
};

export function registerSettings() {
  const g = game.settings;

  g.register(MODULE_ID, SETTINGS.url, {
    name: "VAULTS.Settings.Url.Name",
    hint: "VAULTS.Settings.Url.Hint",
    scope: "world", config: true, type: String, default: "",
  });

  g.register(MODULE_ID, SETTINGS.token, {
    name: "VAULTS.Settings.Token.Name",
    hint: "VAULTS.Settings.Token.Hint",
    scope: "world", config: true, type: String, default: "",
  });

  g.register(MODULE_ID, SETTINGS.role, {
    scope: "world", config: false, type: String, default: "",
  });

  g.register(MODULE_ID, SETTINGS.rootFolder, {
    name: "VAULTS.Settings.RootFolder.Name",
    hint: "VAULTS.Settings.RootFolder.Hint",
    scope: "world", config: true, type: String, default: "Vault",
  });

  g.register(MODULE_ID, SETTINGS.lastManifest, {
    scope: "world", config: false, type: Object, default: {},
  });

  g.register(MODULE_ID, SETTINGS.lastImageManifest, {
    scope: "world", config: false, type: Object, default: {},
  });

  g.register(MODULE_ID, SETTINGS.pendingState, {
    scope: "world", config: false, type: String, default: "",
  });
}

export const get = (k) => game.settings.get(MODULE_ID, k);
export const set = (k, v) => game.settings.set(MODULE_ID, k, v);
