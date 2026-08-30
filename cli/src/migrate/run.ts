// Migration orchestrator. Walks the registry, runs each migration whose
// needs() returns true, and reports what happened.
//
// Called automatically at the top of every command that touches a vault.
// A settled migration is recorded in .vaults/migrations.json and never
// consulted again: needs() may read the whole vault to answer, and paying
// that on every command forever is the wrong price for a one-shot rewrite.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Migration, MigrationResult } from "./types.js";
import { MIGRATIONS } from "./registry.js";

const MARKER = ".vaults/migrations.json";

async function readSettled(vaultPath: string): Promise<Set<string>> {
  try {
    const ids = JSON.parse(await readFile(join(vaultPath, MARKER), "utf8"));
    return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeSettled(vaultPath: string, ids: Set<string>): Promise<void> {
  await mkdir(join(vaultPath, ".vaults"), { recursive: true });
  await writeFile(join(vaultPath, MARKER), JSON.stringify([...ids].sort()) + "\n");
}

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
  // `only` is a hand-run and ignores the record, so a migration can be forced.
  const settled = opts.only ? new Set<string>() : await readSettled(vaultPath);
  let recorded = false;
  for (const m of candidates) {
    if (settled.has(m.id)) {
      skipped.push(m.id);
      continue;
    }
    if (!(await m.needs(vaultPath))) {
      skipped.push(m.id);
      if (!opts.dryRun && !opts.only) { settled.add(m.id); recorded = true; }
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
    if (!opts.only) { settled.add(m.id); recorded = true; }
  }
  if (recorded) await writeSettled(vaultPath, settled);
  return { applied, skipped };
}

export function listMigrations(): ReadonlyArray<Migration> {
  return MIGRATIONS;
}
