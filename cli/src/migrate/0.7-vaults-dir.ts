// Migration: consolidate vaults-cli internals into .vaults/.
//
//   .vaultrc.json  →  .vaults/config.json
//   .vault-cache/  →  .vaults/cache/
//
// Also writes .vaults/.gitignore so the cache + config (the latter holds
// hashed passwords and session secret pointers) stay out of git when the
// vault later becomes a git repo.
//
// settings.md stays at the vault root: it's user-edited from Obsidian, and
// dotfolders are hidden from Obsidian's file pane by default.

import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Migration } from "./types.js";
import {
  configPath,
  cacheDir,
  vaultsGitignore,
  legacyConfigPath,
  legacyCacheDir,
  CACHE_DIR,
  CONFIG_FILE,
} from "../paths.js";

export const vaultsDirMigration: Migration = {
  id: "0.7-vaults-dir",
  description: ".vaultrc.json → .vaults/config.json, .vault-cache/ → .vaults/cache/",

  async needs(vaultPath: string): Promise<boolean> {
    return (await exists(legacyConfigPath(vaultPath))) || (await exists(legacyCacheDir(vaultPath)));
  },

  async apply(vaultPath: string): Promise<void> {
    const newConfig = configPath(vaultPath);
    const newCache = cacheDir(vaultPath);
    await mkdir(dirname(newConfig), { recursive: true });

    if (await exists(legacyConfigPath(vaultPath))) {
      // Skip move if dest already exists; the legacy file is then likely
      // a leftover the user can delete by hand.
      if (!(await exists(newConfig))) {
        await rename(legacyConfigPath(vaultPath), newConfig);
      }
    }

    if (await exists(legacyCacheDir(vaultPath))) {
      if (!(await exists(newCache))) {
        await rename(legacyCacheDir(vaultPath), newCache);
      }
    }

    await ensureVaultsGitignore(vaultPath);
  },
};

/**
 * Write a default .vaults/.gitignore if one doesn't already exist. Listed
 * from .vaults/ so the entries are relative — works whether or not the
 * containing vault is a git repo.
 */
export async function ensureVaultsGitignore(vaultPath: string): Promise<void> {
  const path = vaultsGitignore(vaultPath);
  if (await exists(path)) return;
  const lines = [
    "# vaults-cli internal state — do not edit by hand.",
    "# These entries are forward-compat: if this vault becomes a git repo,",
    "# the cache and config (which holds hashed passwords) stay out.",
    `${CACHE_DIR}/`,
    CONFIG_FILE,
    "",
  ].join("\n");
  await writeFile(path, lines);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
