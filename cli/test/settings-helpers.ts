// Write a vault's settings file for tests that read it back through
// loadSettings directly, with no build (and so no migration) in between.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { settingsPath } from "../src/paths.js";

export async function writeSettingsFile(vaultPath: string, yaml: string): Promise<void> {
  const path = settingsPath(vaultPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, yaml);
}
