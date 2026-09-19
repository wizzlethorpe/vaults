// Migration: foundry.package -> foundry.enabled, foundry.module dropped, and the
// version stamp of the module vaults used to build dropped from config.json.

import { readFile, writeFile } from "node:fs/promises";
import { load as loadYaml } from "js-yaml";
import { configPath, exists, loadSettings, type Migration, settingsPath, writeSettings } from "@wizzlethorpe/vaults/addon";

const RETIRED = ["package", "module"];
const STAMP = "foundryModule";

/** The retired keys still present under `foundry:`, read as values not text. */
async function retired(vaultPath: string): Promise<Record<string, unknown>> {
  if (!(await exists(settingsPath(vaultPath)))) return {};
  const raw = await readFile(settingsPath(vaultPath), "utf8");
  const loaded = loadYaml(raw) as Record<string, unknown> | null;
  const foundry = loaded?.["foundry"];
  if (foundry === null || typeof foundry !== "object" || Array.isArray(foundry)) return {};
  return Object.fromEntries(
    Object.entries(foundry as Record<string, unknown>).filter(([k]) => RETIRED.includes(k)),
  );
}

/** config.json, when it still carries the module's version stamp. */
async function stamped(vaultPath: string): Promise<Record<string, unknown> | null> {
  if (!(await exists(configPath(vaultPath)))) return null;
  const config = JSON.parse(await readFile(configPath(vaultPath), "utf8")) as Record<string, unknown>;
  return STAMP in config ? config : null;
}

export const foundryEnabledMigration: Migration = {
  id: "0.23-foundry-enabled",
  description: "foundry.package -> foundry.enabled, and the module version stamp dropped",

  async needs(vaultPath: string): Promise<boolean> {
    return Object.keys(await retired(vaultPath)).length > 0 || (await stamped(vaultPath)) !== null;
  },

  async apply(vaultPath: string): Promise<void> {
    const keys = await retired(vaultPath);
    if (Object.keys(keys).length > 0) {
      const { values } = await loadSettings(vaultPath);
      const { foundry } = values as unknown as { foundry: Record<string, unknown> };
      // Only `none` ever meant off. Anything else leaves the `enabled` the block states, or its default.
      if (keys["package"] === "none") foundry["enabled"] = false;
      for (const key of RETIRED) delete foundry[key];
      await writeSettings(vaultPath, values);
    }
    const config = await stamped(vaultPath);
    if (config) {
      delete config[STAMP];
      await writeFile(configPath(vaultPath), JSON.stringify(config, null, 2) + "\n");
    }
  },
};
