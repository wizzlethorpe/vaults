import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

// Single source of truth for settings: name, type, default, description.
// To add a setting, add a line here. The schema drives parsing, normalisation,
// the init template, and the warning for unknown keys.
export interface Settings {
  vault_name: string;
  image_quality: number;
  max_file_bytes: number;
}

interface SettingDef<K extends keyof Settings> {
  default: Settings[K];
  type: "string" | "number" | "boolean";
  description: string;
}

const SCHEMA: { [K in keyof Settings]: SettingDef<K> } = {
  vault_name: {
    default: "Vault",
    type: "string",
    description: "Display name for the wiki (shown in header and page titles).",
  },
  image_quality: {
    default: 85,
    type: "number",
    description: "WebP quality 1–100 for image compression. Set 0 to disable.",
  },
  max_file_bytes: {
    default: 25 * 1024 * 1024,
    type: "number",
    description: "Hard cap (in bytes) on a single file. Larger files are skipped.",
  },
};

export const SETTINGS_FILE = "settings.md";

export interface LoadedSettings {
  values: Settings;
  /** Was the on-disk version already canonical? If false, callers may want to write back. */
  changed: boolean;
  warnings: string[];
}

/**
 * Read settings.md from a vault, normalise its values against the schema,
 * fill defaults, and surface warnings for unknown keys.
 */
export async function loadSettings(vaultPath: string): Promise<LoadedSettings> {
  const path = join(vaultPath, SETTINGS_FILE);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // No settings file — return defaults, mark as changed so caller can init.
    const values = defaults();
    return { values, changed: true, warnings: [] };
  }

  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const values = defaults();

  // Apply user-provided values that match the schema.
  for (const [key, def] of Object.entries(SCHEMA) as [keyof Settings, SettingDef<keyof Settings>][]) {
    if (!(key in fm)) continue;
    const v = fm[key];
    if (typeof v !== def.type) {
      warnings.push(`settings.md: '${key}' should be a ${def.type}, got ${typeof v}. Using default.`);
      continue;
    }
    (values as unknown as Record<string, unknown>)[key] = v;
  }

  // Warn about unknown keys.
  for (const key of Object.keys(fm)) {
    if (!(key in SCHEMA)) {
      warnings.push(`settings.md: unknown setting '${key}' will be removed on next sync.`);
    }
  }

  // Has the canonical form drifted from on-disk?
  const canonical = renderSettingsFile(values);
  return { values, changed: canonical !== raw, warnings };
}

/**
 * Write settings.md to disk in canonical form. Used by `init` and by the
 * build pipeline whenever the on-disk file drifts from canonical.
 */
export async function writeSettings(vaultPath: string, values: Settings): Promise<void> {
  await writeFile(join(vaultPath, SETTINGS_FILE), renderSettingsFile(values));
}

function defaults(): Settings {
  return Object.fromEntries(
    Object.entries(SCHEMA).map(([k, def]) => [k, def.default]),
  ) as unknown as Settings;
}

function renderSettingsFile(values: Settings): string {
  const lines: string[] = ["---"];
  for (const [key, def] of Object.entries(SCHEMA) as [keyof Settings, SettingDef<keyof Settings>][]) {
    lines.push(`# ${def.description}`);
    lines.push(`${key}: ${formatValue((values as unknown as Record<string, unknown>)[key])}`);
    lines.push("");
  }
  // Trim trailing blank line before closing fence.
  while (lines[lines.length - 1] === "") lines.pop();
  lines.push("---", "");
  lines.push("# Vault settings");
  lines.push("");
  lines.push("This file is managed by `vaults`. Edit values above (in the frontmatter).");
  lines.push("Unknown keys are removed on the next sync.");
  lines.push("");
  return lines.join("\n");
}

function formatValue(v: unknown): string {
  if (typeof v === "string") {
    // Quote only if necessary so YAML stays human-friendly.
    return /^[A-Za-z0-9 _.-]+$/.test(v) ? v : JSON.stringify(v);
  }
  return String(v);
}
