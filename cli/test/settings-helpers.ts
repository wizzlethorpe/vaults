// Write a vault's settings file for tests that read it back through
// loadSettings directly, with no build (and so no migration) in between.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { settingsPath } from "../src/paths.js";

export async function writeSettingsFile(vaultPath: string, yaml: string): Promise<void> {
  const path = settingsPath(vaultPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, yaml);
}

/** A vault `vaults set` will act on: one that has been initialised. */
export async function initialised(settings = ""): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
  await writeSettingsFile(dir, settings);
  return dir;
}

/** Run `fn` with console output captured rather than printed. */
export async function quiet(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const origLog = console.log, origWarn = console.warn;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.log = origLog; console.warn = origWarn; }
  return lines;
}
