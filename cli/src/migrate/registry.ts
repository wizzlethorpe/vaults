// Ordered list of migrations. Newer migrations append at the end.

import type { Migration } from "./types.js";
import { vaultsDirMigration } from "./0.7-vaults-dir.js";
import { foundryPatchKeysMigration } from "./0.15-foundry-patch-keys.js";
import { foundryPinnedIdMigration } from "./0.15-foundry-pinned-id.js";

export const MIGRATIONS: ReadonlyArray<Migration> = [
  vaultsDirMigration,
  foundryPatchKeysMigration,
  foundryPinnedIdMigration,
];
