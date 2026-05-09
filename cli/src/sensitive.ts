import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative } from "node:path";

/**
 * Loud warning when a file that contains secrets is about to be written.
 * Today's only secrets-bearing file is `.env` (session-signing key,
 * Patreon client secret); `.vaultrc.json` itself is config-only as of
 * the secrets split and is intentionally trackable.
 *
 * The check is best-effort: if `git` isn't on PATH, or the vault isn't
 * inside a git repo, we still emit a quieter reminder. Never throws —
 * a wrong gitignore guess shouldn't block writing the file.
 */
export async function warnSensitive(
  vaultPath: string,
  filePath: string,
  what: string = "the session-signing key and (when configured) the Patreon client secret",
): Promise<void> {
  const gitRoot = await findGitRoot(vaultPath);
  if (!gitRoot) {
    console.warn(
      `  \x1b[33m⚠\x1b[0m ${filePath} contains ${what}. `
      + `If you ever put this vault under git, gitignore it first.`,
    );
    return;
  }

  const ignored = await isGitIgnored(gitRoot, vaultPath, filePath);
  if (ignored) return; // healthy state — silent

  console.warn(
    `\n  \x1b[31m⚠ SECURITY:\x1b[0m ${filePath} is NOT gitignored in this repo!`,
  );
  console.warn(`  This file contains ${what}. Add it to .gitignore before committing.`);
  console.warn(
    `    cd ${gitRoot} && echo "${pathRelativeToRepoRoot(gitRoot, vaultPath, filePath)}" >> .gitignore\n`,
  );
}

async function findGitRoot(start: string): Promise<string | null> {
  let dir = start;
  for (let i = 0; i < 32; i++) { // generous loop bound; protects against symlink cycles
    try {
      const s = await stat(join(dir, ".git"));
      if (s.isDirectory() || s.isFile()) return dir;
    } catch { /* keep walking */ }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

async function isGitIgnored(gitRoot: string, vaultPath: string, filePath: string): Promise<boolean> {
  const fullPath = join(vaultPath, filePath);
  return new Promise((resolve) => {
    // `git check-ignore` exits 0 when the path IS ignored, 1 when not, 128
    // on error. Errors (no git, permissions) → assume not ignored so we
    // err on the side of warning.
    const proc = spawn("git", ["-C", gitRoot, "check-ignore", "--quiet", fullPath], {
      stdio: "ignore",
    });
    proc.on("exit", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

function pathRelativeToRepoRoot(gitRoot: string, vaultPath: string, filePath: string): string {
  return relative(gitRoot, join(vaultPath, filePath)).split(/[/\\]/).join("/");
}
