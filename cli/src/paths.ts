// Centralised vault-internal path constants.
//
// The single source of truth for where vaults-cli keeps its own state
// inside a vault. Migrations rely on these to move files from old to new
// locations; runtime code should always use the helpers below rather than
// hardcoding strings.

import { join } from "node:path";

/** Top-level dotfolder owning all vaults-cli state. */
export const VAULTS_DIR = ".vaults";

/** Settings.md stays at the vault root (Obsidian-editable). */
export const SETTINGS_FILE = "settings.md";

/** Config (CLI-managed: roles, password hashes, project name, patreon, …). */
export const CONFIG_FILE = "config.json";

/** Build artifact directory (rendered HTML, image webp cache). */
export const CACHE_DIR = "cache";

/** Custom handler modules + assets (already established in .vaults/). */
export const HANDLERS_DIR = "handlers";

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

/** Fully-qualified handlers directory path. */
export function handlersDir(vaultPath: string): string {
  return join(vaultPath, VAULTS_DIR, HANDLERS_DIR);
}

/** Fully-qualified .vaults/.gitignore path. */
export function vaultsGitignore(vaultPath: string): string {
  return join(vaultPath, VAULTS_DIR, VAULTS_GITIGNORE);
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
