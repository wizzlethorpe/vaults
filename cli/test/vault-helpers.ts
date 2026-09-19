// A temp vault on disk and a quiet build of it, for tests that go through buildSite().

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

export interface Vault { dir: string; out: string; }

/** Build a temp vault from a path → contents map; caller must `cleanup`. */
export async function setupVault(files: Record<string, string | Buffer>): Promise<Vault> {
  // image_quality: 0 skips sharp, which these fixtures need: their "images" are placeholder bytes, not real encodings.
  if (!("settings.md" in files)) {
    files = { "settings.md": "---\nimage_quality: 0\n---\n", ...files };
  }
  const dir = await mkdtemp(join(tmpdir(), "vault-test-"));
  const out = join(dir, "_out");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return { dir, out };
}

export async function cleanup(v: Vault): Promise<void> {
  await rm(v.dir, { recursive: true, force: true });
}

/** Builds with the progress output swallowed; assertions read what was written. */
export async function build(v: Vault): Promise<void> {
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await buildSite({ vaultPath: v.dir, outputDir: v.out });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

export async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export const VAULTRC_1 = JSON.stringify({ roles: ["public"], rolePasswords: {} });

/** Three-role vaultrc with placeholder password hashes (roleAdd hashes match this shape). */
export const VAULTRC_3 = JSON.stringify({
  roles: ["public", "patron", "dm"],
  rolePasswords: { patron: "100000:0000:0000", dm: "100000:0000:0000" },
});

export const VARIANT = (role: string, path: string) => `_variants/${role}/${path}`;
