import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";

export interface ScannedFile {
  /** Vault-relative POSIX path (forward slashes). */
  path: string;
  /** Absolute path on disk. */
  absolute: string;
  size: number;
  /** MD5 hex digest of the file body — matches R2's etag format for single-part uploads. */
  hash: string;
  /** Unix-seconds; when the file was last modified on disk. */
  mtime: number;
  /** Unix-seconds; when the file was created (best-effort — may equal mtime on Linux). */
  birthtime: number;
}

const IGNORED_DIRS = new Set([".git", ".obsidian", ".trash", "node_modules", ".vault-cache"]);
const IGNORED_FILES = new Set([".DS_Store", ".vaultrc.json"]);

export async function scanVault(root: string): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  await walk(root, root, out);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walk(root: string, dir: string, out: ScannedFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(root, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (IGNORED_FILES.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const body = await readFile(abs);
    const info = await stat(abs);
    const mtime = Math.floor(info.mtimeMs / 1000);
    // Linux often reports birthtime as 0; fall back to mtime so the rendered
    // "Created" line is at least sensible.
    const rawBirth = Math.floor(info.birthtimeMs / 1000);
    const birthtime = rawBirth > 0 ? rawBirth : mtime;
    out.push({
      path: relative(root, abs).split(sep).join("/"),
      absolute: abs,
      size: info.size,
      hash: createHash("md5").update(body).digest("hex"),
      mtime,
      birthtime,
    });
  }
}
