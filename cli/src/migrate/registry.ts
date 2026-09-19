// Core's migrations, in order. Append at the end.

import type { Migration } from "./types.js";
import { vaultsDirMigration } from "./0.7-vaults-dir.js";
import { settingsYamlMigration } from "./0.22-settings-yaml.js";

export const MIGRATIONS: ReadonlyArray<Migration> = [
  vaultsDirMigration,
  settingsYamlMigration,
];
