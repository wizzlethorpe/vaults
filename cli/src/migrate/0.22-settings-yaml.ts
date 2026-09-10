// Migration: settings.md at the vault root → .vaults/settings.yaml.
//
// Obsidian hides dot-folders, which is what takes the file out of the note
// list, the quick switcher and the graph.

import { readFile, rm } from "node:fs/promises";
import matter from "gray-matter";
import type { Migration } from "./types.js";
import { exists, legacySettingsPath, settingsPath, VAULTS_DIR, SETTINGS_FILE } from "../paths.js";
import { normalizeSettings, writeSettings } from "../settings.js";

export const settingsYamlMigration: Migration = {
  id: "0.22-settings-yaml",
  description: `settings.md → ${VAULTS_DIR}/${SETTINGS_FILE}`,

  async needs(vaultPath: string): Promise<boolean> {
    return (await exists(legacySettingsPath(vaultPath))) && !(await exists(settingsPath(vaultPath)));
  },

  async apply(vaultPath: string): Promise<void> {
    const raw = await readFile(legacySettingsPath(vaultPath), "utf8");
    const { values } = normalizeSettings(matter(raw).data);
    // Written before the old file is removed, so an interrupt leaves both and
    // needs() then correctly reports nothing to do.
    await writeSettings(vaultPath, values);
    await rm(legacySettingsPath(vaultPath));
  },
};

