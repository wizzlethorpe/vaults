import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

// Single source of truth for user-editable settings: name, type, default,
// description. To add a setting, add a line here. The schema drives parsing,
// normalisation, the init template, and the warning for unknown keys.
//
// Auth config (roles, role_passwords, auth_type) lives in .vaultrc.json
// instead — it's CLI-managed (`vaults role add/remove/promote/demote`,
// `vaults password`) and shouldn't be hand-edited or git-tracked.
export interface Settings {
  vault_name: string;
  image_quality: number;
  max_file_bytes: number;
  ignore: string[];
  inline_title: boolean;
  default_image_width: string;
  center_images: boolean;
}

type SettingType = "string" | "number" | "boolean" | "string[]";

interface SettingDef<K extends keyof Settings> {
  default: Settings[K];
  type: SettingType;
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
  ignore: {
    default: [],
    type: "string[]",
    description:
      "Glob patterns of files to skip when rendering and syncing. Examples: 'Templates/**', '*.draft.md', 'Private/**'.",
  },
  inline_title: {
    default: true,
    type: "boolean",
    description:
      "Inject the page title as an <h1> at the top. Set false if your notes already start with a '# Title' heading and you don't want the duplicate.",
  },
  default_image_width: {
    default: "50vw",
    type: "string",
    description:
      "CSS width applied to images embedded without an explicit '|N' size hint. Any valid CSS dimension works (50vw, 400px, 100%, etc). Set empty string to leave images at natural size.",
  },
  center_images: {
    default: true,
    type: "boolean",
    description:
      "Center images in the article body. Set false to leave them flush left.",
  },
};

export const SETTINGS_FILE = "settings.md";

export interface LoadedSettings {
  values: Settings;
  /** Did settings.md exist on disk? If false, defaults were used. */
  exists: boolean;
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
    const values = defaults();
    return { values, exists: false, changed: false, warnings: [] };
  }

  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const values = defaults();

  for (const [key, def] of Object.entries(SCHEMA) as [keyof Settings, SettingDef<keyof Settings>][]) {
    if (!(key in fm)) continue;
    const v = fm[key];
    if (!matchesType(v, def.type)) {
      warnings.push(`settings.md: '${key}' should be a ${def.type}, got ${describeType(v)}. Using default.`);
      continue;
    }
    (values as unknown as Record<string, unknown>)[key] = v;
  }

  for (const key of Object.keys(fm)) {
    if (!(key in SCHEMA)) {
      warnings.push(`settings.md: unknown setting '${key}' will be removed on next sync.`);
    }
  }

  const canonical = renderSettingsFile(values);
  return { values, exists: true, changed: canonical !== raw, warnings };
}

/**
 * Write settings.md to disk in canonical form. Used by `init` and by `push`
 * whenever the on-disk file drifts from canonical.
 */
export async function writeSettings(vaultPath: string, values: Settings): Promise<void> {
  await writeFile(join(vaultPath, SETTINGS_FILE), renderSettingsFile(values));
}

function defaults(): Settings {
  return Object.fromEntries(
    Object.entries(SCHEMA).map(([k, def]) => [k, def.default]),
  ) as unknown as Settings;
}

function matchesType(v: unknown, t: SettingType): boolean {
  if (t === "string[]") return Array.isArray(v) && v.every((item) => typeof item === "string");
  return typeof v === t;
}

function describeType(v: unknown): string {
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function renderSettingsFile(values: Settings): string {
  const lines: string[] = ["---"];
  for (const [key, def] of Object.entries(SCHEMA) as [keyof Settings, SettingDef<keyof Settings>][]) {
    lines.push(`# ${def.description}`);
    const value = (values as unknown as Record<string, unknown>)[key];
    if (def.type === "string[]") {
      const arr = (value ?? []) as string[];
      if (arr.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of arr) lines.push(`  - ${formatString(item)}`);
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
    lines.push("");
  }
  while (lines[lines.length - 1] === "") lines.pop();
  lines.push("---", "");
  lines.push("# Vault settings");
  lines.push("");
  lines.push("This file is managed by `vaults`. Edit values above (in the frontmatter).");
  lines.push("Unknown keys are removed on the next sync.");
  lines.push("");
  return lines.join("\n");
}

function formatScalar(v: unknown): string {
  if (typeof v === "string") return formatString(v);
  return String(v);
}

function formatString(v: string): string {
  return /^[A-Za-z0-9 _.-]+$/.test(v) ? v : JSON.stringify(v);
}
