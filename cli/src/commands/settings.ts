import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import {
  loadSettings,
  normalizeSettings,
  writeSettings,
  SCHEMA,
  SETTINGS_FILE,
  type Settings,
} from "../settings.js";
import { requireInitialisedVault } from "../paths.js";
import { runMigrations } from "../migrate/run.js";

/** A value as one line where it fits on one, and as a YAML block otherwise. */
function format(value: unknown): string {
  return typeof value === "string" ? value : dumpYaml(value).trimEnd();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readPath(values: Settings, path: string[]): unknown {
  let node: unknown = values;
  for (const key of path) {
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return node;
}

function writePath(values: Settings, path: string[], value: unknown): void {
  let node = values as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[path[path.length - 1]!] = value;
}

/** The key path, checked against the schema. */
function resolveKey(key: string): string[] {
  const path = key.split(".");
  const def = SCHEMA[path[0] as keyof Settings];
  if (!def) throw new Error(`Unknown setting '${path[0]}'. Run \`vaults get\` to list them.`);
  if (path.length > 1 && def.type !== "object") {
    throw new Error(`'${path[0]}' is a ${def.type} and has no nested keys.`);
  }
  return path;
}

export async function settingsSet(key: string, value: string, vaultPath: string): Promise<void> {
  await requireInitialisedVault(vaultPath);
  await runMigrations(vaultPath);
  const path = resolveKey(key);
  const { values } = await loadSettings(vaultPath);

  // A string setting takes the argument verbatim: YAML would read `#7a4a8c`
  // as a comment. Everything else goes through the parser the file itself is
  // read with, which is how a list or an object reaches a setting.
  const parsed = typeof readPath(values, path) === "string" ? value : loadYaml(value);
  writePath(values, path, parsed);

  // Both ways the schema refuses a value have to stop the write, or the file
  // records something the build ignores: substituting a default, which
  // `stored` shows, and warning without substituting, which is how
  // foundry.core_version rejects an unquoted number.
  const checked = normalizeSettings(values);
  const stored = readPath(checked.values, path);
  const complaint = checked.warnings.find((w) => w.includes(`'${key}'`));
  if (complaint || JSON.stringify(stored) !== JSON.stringify(parsed)) {
    throw new Error(
      `Refusing to set '${key}' to ${JSON.stringify(parsed)}: `
      + (complaint ?? `the schema replaced it with ${JSON.stringify(stored)}.`),
    );
  }
  for (const w of checked.warnings) console.warn(`  ${w}`);

  await writeSettings(vaultPath, checked.values);
  const shown = format(stored);
  console.log(shown.includes("\n") ? `${key}:\n${shown}` : `${key}: ${shown}`);
}

export async function settingsGet(key: string | undefined, vaultPath: string): Promise<void> {
  await requireInitialisedVault(vaultPath);
  await runMigrations(vaultPath);
  const { values, exists } = await loadSettings(vaultPath);
  if (!exists) console.warn(`  no ${SETTINGS_FILE}; showing defaults.`);

  if (key === undefined) {
    for (const name of Object.keys(SCHEMA) as (keyof Settings)[]) {
      console.log(`${name}: ${format(values[name])}`);
    }
    return;
  }

  const value = readPath(values, resolveKey(key));
  if (value === undefined) throw new Error(`'${key}' is not set.`);
  console.log(format(value));
}
