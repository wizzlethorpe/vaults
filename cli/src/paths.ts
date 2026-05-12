// Centralised vault-internal path constants.
//
// The single source of truth for where vaults-cli keeps its own state
// inside a vault. Migrations rely on these to move files from old to new
// locations; runtime code should always use the helpers below rather than
// hardcoding strings.

import { stat } from "node:fs/promises";
import { join } from "node:path";

/** Top-level dotfolder owning all vaults-cli state. */
export const VAULTS_DIR = ".vaults";

/** Settings.md stays at the vault root (Obsidian-editable). */
export const SETTINGS_FILE = "settings.md";

/** Config (CLI-managed: roles, password hashes, project name, patreon, …). */
export const CONFIG_FILE = "config.json";

/** Build artifact directory (rendered HTML, image webp cache). */
export const CACHE_DIR = "cache";

/** Internal .gitignore so cache + secrets stay out of git when the vault becomes a git repo. */
export const VAULTS_GITIGNORE = ".gitignore";

/** Fully-qualified config file path. */
export function configPath(vaultPath: string): string {
  return join(vaultPath, VAULTS_DIR, CONFIG_FILE);
}

/** Fully-qualified cache directory path. */
export function cacheDir(vaultPath: string): string {
  return join(vaultPath, VAULTS_DIR, CACHE_DIR);
}

/** Fully-qualified rendered output directory (default for build/preview/push). */
export function defaultOutputDir(vaultPath: string): string {
  return join(cacheDir(vaultPath), "rendered");
}

/** Fully-qualified .vaults/.gitignore path. */
export function vaultsGitignore(vaultPath: string): string {
  return join(vaultPath, VAULTS_DIR, VAULTS_GITIGNORE);
}

/**
 * Throw with a friendly error if `vaultPath` doesn't look like an
 * initialised vault. The marker is `settings.md` at the vault root —
 * `vaults init` writes it; the rest of the CLI (build / preview / push /
 * role / patreon / password) reads it.
 *
 * Catches the common confused-cwd case — `vaults preview` from $HOME or
 * a parent directory — with a clear next step instead of an opaque
 * "wrangler exited 1" / blank build a few seconds later.
 */
export async function requireInitialisedVault(vaultPath: string): Promise<void> {
  const marker = join(vaultPath, SETTINGS_FILE);
  try { await stat(marker); }
  catch {
    throw new Error(
      `Not a vaults-initialised directory: ${vaultPath}\n` +
      `Missing ${SETTINGS_FILE}. Run \`vaults init\` here first, or pass the vault path as the first argument.`,
    );
  }
}

// ── Legacy paths (pre-migration) ─────────────────────────────────────────
// Kept exported so migrations can detect old layouts and move files.
// Runtime code must NOT read from these.

export const LEGACY_CONFIG_FILE = ".vaultrc.json";
export const LEGACY_CACHE_DIR = ".vault-cache";

export function legacyConfigPath(vaultPath: string): string {
  return join(vaultPath, LEGACY_CONFIG_FILE);
}

export function legacyCacheDir(vaultPath: string): string {
  return join(vaultPath, LEGACY_CACHE_DIR);
}
