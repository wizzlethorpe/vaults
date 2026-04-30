import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadSettings, writeSettings, SETTINGS_FILE } from "../settings.js";

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
    } catch { /* doesn't exist — we're good */ }
  }

  // loadSettings() returns defaults when the file is missing, so we can just
  // write that out untouched as the canonical starting point.
  const { values } = await loadSettings(vaultPath);
  await writeSettings(vaultPath, values);
  console.log(`Wrote ${target}.`);
  console.log("Open it in Obsidian to edit the frontmatter — it'll show as a settings form.");
}
