// Migration framework: stateless, idempotent, forward-only schema and
// layout migrations for vaults.
//
// Each migration knows how to detect (from on-disk reality) whether it
// still needs to apply, and how to apply itself. Running a migration twice
// is a no-op. There is no version file: needs() reads the disk directly.

export interface Migration {
  /** Stable identifier for logging. Convention: "<release-version>-<slug>". */
  id: string;
  /** One-line, user-readable summary of what changes. */
  description: string;
  /** True if the migration still has work to do on this vault. Idempotent. */
  needs(vaultPath: string): Promise<boolean>;
  /** Apply the migration. Should be safe to interrupt — leave the vault in either the old or new state, never half. */
  apply(vaultPath: string): Promise<void>;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}
