import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSettings, writeSettings, SETTINGS_FILE } from "../settings.js";
import { ensureVaultsGitignore } from "../migrate/0.7-vaults-dir.js";

interface InitOptions {
  force?: boolean;
}

export async function init(vaultPath: string, opts: InitOptions): Promise<void> {
  const target = join(vaultPath, SETTINGS_FILE);

  // Verify the path is actually a directory before scribbling on it.
  try {
    const info = await stat(vaultPath);
    if (!info.isDirectory()) throw new Error(`${vaultPath} is not a directory`);
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "ENOENT") {
      throw new Error(`Vault path does not exist: ${vaultPath}`);
    }
    throw err;
  }

  if (!opts.force) {
    try {
      await stat(target);
      console.error(`${target} already exists. Use --force to overwrite.`);
      process.exit(1);
    } catch { /* doesn't exist; we're good */ }
  }

  // loadSettings() returns defaults when the file is missing, so we can just
  // write that out untouched as the canonical starting point.
  const { values } = await loadSettings(vaultPath);
  await writeSettings(vaultPath, values);
  console.log(`Wrote ${target}.`);

  // Vaults-internal state lives in .vaults/. Write a .gitignore there now
  // so the cache + secrets-bearing config stay out of git when this vault
  // becomes a git repo (cheap forward-compat for non-git vaults too).
  await ensureVaultsGitignore(vaultPath);
  // .env holds the only real secrets the CLI manages: SESSION_SECRET and
  // PATREON_CLIENT_SECRET. Drop a top-level .gitignore entry for it (and
  // the .vaults/ dir) only when the vault is already versioned.
  await ensureRootGitignoreEntries(vaultPath, [".env"]);

  console.log("Open it in Obsidian to edit the frontmatter; it'll show as a settings form.");
}

/**
 * Add `entries` to the vault's root `.gitignore` if they aren't already
 * there. Only runs when the vault looks like a git repo (`.git` present)
 * or already has a `.gitignore`; otherwise we'd be creating an orphan
 * file in a vault the user never intended to version.
 */
async function ensureRootGitignoreEntries(vaultPath: string, entries: string[]): Promise<void> {
  const path = join(vaultPath, ".gitignore");
  let current = "";
  let gitignoreExists = false;
  try {
    current = await readFile(path, "utf8");
    gitignoreExists = true;
  } catch { /* file doesn't exist yet */ }

  if (!gitignoreExists) {
    try { await stat(join(vaultPath, ".git")); }
    catch { return; } // no .git and no .gitignore; vault isn't versioned
  }

  const existing = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !existing.has(e));
  if (missing.length === 0) return;

  const prefix = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await writeFile(path, current + prefix + missing.join("\n") + "\n");
  console.log(`Updated ${path} (+${missing.join(", ")}).`);
}
