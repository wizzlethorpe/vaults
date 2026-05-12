// Ordered list of migrations. Newer migrations append at the end.

import type { Migration } from "./types.js";
import { vaultsDirMigration } from "./0.7-vaults-dir.js";

export const MIGRATIONS: ReadonlyArray<Migration> = [
  vaultsDirMigration,
];
