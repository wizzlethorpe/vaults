// Migration orchestrator. Walks the registry, runs each migration whose
// needs() returns true, and reports what happened.
//
// Called automatically at the top of every command that touches a vault.
// Migrations are designed to be cheap to skip (stat a file, compare two
// strings) so the overhead on already-migrated vaults is negligible.

import type { Migration, MigrationResult } from "./types.js";
import { MIGRATIONS } from "./registry.js";

export interface RunMigrationsOpts {
  /** Skip apply(); just report what would run. */
  dryRun?: boolean;
  /** Run only the migration with this id (skip needs() for everything else). */
  only?: string;
  /** Suppress per-migration logs (errors and the summary still print). */
  silent?: boolean;
}

export async function runMigrations(
  vaultPath: string,
  opts: RunMigrationsOpts = {},
): Promise<MigrationResult> {
  const candidates = opts.only
    ? MIGRATIONS.filter((m) => m.id === opts.only)
    : MIGRATIONS;
  if (opts.only && candidates.length === 0) {
    throw new Error(`unknown migration id: ${opts.only}`);
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const m of candidates) {
    if (!(await m.needs(vaultPath))) {
      skipped.push(m.id);
      continue;
    }
    if (opts.dryRun) {
      if (!opts.silent) console.log(`  would migrate: ${m.id} — ${m.description}`);
      applied.push(m.id);
      continue;
    }
    if (!opts.silent) console.log(`  migrating: ${m.id} — ${m.description}`);
    await m.apply(vaultPath);
    applied.push(m.id);
  }
  return { applied, skipped };
}

export function listMigrations(): ReadonlyArray<Migration> {
  return MIGRATIONS;
}
