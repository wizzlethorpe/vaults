// Ordered list of migrations.
//
// Order matters: the .vaults-dir migration must run BEFORE legacy-auth so
// loadConfig() (which legacy-auth uses) can find the config file at its
// new location. Newer migrations append at the end.

import type { Migration } from "./types.js";
import { vaultsDirMigration } from "./0.7-vaults-dir.js";
import { legacyAuthSettingsMigration } from "./0.6-legacy-auth-settings.js";

export const MIGRATIONS: ReadonlyArray<Migration> = [
  vaultsDirMigration,
  legacyAuthSettingsMigration,
];
