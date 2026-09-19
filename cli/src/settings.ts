import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";

// Single source of truth for core's user-editable settings: name, type, default,
// description. To add a setting, add a line here. The schema drives parsing,
// normalisation, the init template, and the warning for unknown keys.
// An add-on's settings join it in settingsSchema().
//
// Auth config (roles, role_passwords, oauth providers) lives in
// .vaults/config.json instead, with secrets mirrored to the vault's .env.
// CLI-managed (`vaults role add/remove/promote/demote`, `vaults password`,
// `vaults patreon …`); shouldn't be hand-edited or git-tracked.
export interface Settings {
  vault_name: string;
  image_quality: number;
  max_file_bytes: number;
  ignore: string[];
  default_frontmatter: FrontmatterRule[];
  folder_notes: boolean;
  inline_title: boolean;
  default_image_width: string;
  center_images: boolean;
  preview_mode: string;
  preview_mode_mobile: string;
  accent_color: string;
  bg_color: string;
  accent_color_dark: string;
  bg_color_dark: string;
  theme: string;
  favicon: string;
  auto_image: boolean;
  include_unknown_files: boolean;
  footer: string;
  site_url: string;
}

/** The largest file Cloudflare Pages deploys. */
export const PAGES_FILE_BYTES = 25 * 1024 * 1024;

type SettingType = "string" | "number" | "boolean" | "string[]" | "rules" | "object";

export interface AnySettingDef {
  default: unknown;
  type: SettingType;
  description: string;
  /** For a string setting with a fixed vocabulary; anything else is rejected. */
  choices?: readonly string[];
}

export interface SettingDef<K extends keyof Settings> extends AnySettingDef {
  default: Settings[K];
}

/**
 * A glob and the frontmatter it supplies to matching pages.
 *
 * Defaults only: anything a page states itself wins. Later rules deep-merge
 * over earlier ones, so a broad rule can set a baseline and a narrow one
 * override part of it.
 */
export interface FrontmatterRule {
  match: string;
  data: Record<string, unknown>;
}

export const SCHEMA: { [K in keyof Settings]: SettingDef<K> } = {
  vault_name: {
    default: "Vault",
    type: "string",
    description: "Display name for the wiki. Shown in the header and in page titles.",
  },
  image_quality: {
    default: 85,
    type: "number",
    description: "WebP quality 1 to 100 for image compression. Set 0 to disable.",
  },
  max_file_bytes: {
    default: PAGES_FILE_BYTES,
    type: "number",
    description: "Hard cap (in bytes) on a single file. Larger files are skipped.",
  },
  default_frontmatter: {
    // Where a vault's default role comes from; there is no separate setting.
    default: [{ match: "**", data: { role: "public" } }],
    type: "rules",
    description:
      "Frontmatter applied to pages matching a glob, as an ordered list of { match, data }. "
      + "Later rules merge over earlier ones, and a page's own frontmatter beats all of them. "
      + "Use it to set a baseline without editing every file, such as a role for the whole vault.",
  },
  ignore: {
    default: [],
    type: "string[]",
    description:
      "Glob patterns of files to skip, e.g. 'Templates/**' or '*.draft.md'. Wildcards cross hidden segments, so 'tools/**' also covers 'tools/.venv/**'.",
  },
  folder_notes: {
    default: false,
    type: "boolean",
    description:
      "Treat a note named after the folder it sits in ('Places/Places.md') as that folder's page, the Obsidian folder-note convention. It is served at the folder's URL ('/Places') and replaces the index the build would otherwise generate there.",
  },
  inline_title: {
    default: true,
    type: "boolean",
    description:
      "Inject the page title as an <h1>. Set false if your notes already start with their own '# Title'.",
  },
  default_image_width: {
    default: "300px",
    type: "string",
    description:
      "CSS width for images embedded without a '|N' size hint (300px, 50vw, 100%). Empty leaves them at natural size.",
  },
  center_images: {
    default: true,
    type: "boolean",
    description:
      "Center images in the article body. Set false to leave them flush left.",
  },
  preview_mode: {
    default: "normal",
    type: "string",
    description:
      "Link previews on desktop: 'normal' hovers a preview and navigates on click, 'sticky' pins the preview open on click instead, 'none' disables them.",
  },
  preview_mode_mobile: {
    default: "sticky",
    type: "string",
    description:
      "Link previews on touch, where there is no hover: 'sticky' shows a preview on tap with a 'Go to page' link, 'none' disables them. 'normal' behaves like 'none' here.",
  },
  accent_color: {
    default: "",
    type: "string",
    description:
      "Accent color for links, headings and highlights. Any CSS color. Empty uses the built-in scarlet.",
  },
  bg_color: {
    default: "",
    type: "string",
    description:
      "Background color for the light palette. Any CSS color. Empty uses the built-in parchment.",
  },
  accent_color_dark: {
    default: "",
    type: "string",
    description:
      "Accent color for the dark palette. Empty uses the built-in brighter scarlet.",
  },
  bg_color_dark: {
    default: "",
    type: "string",
    description:
      "Background color for the dark palette. Empty uses the built-in deep warm dark.",
  },
  theme: {
    default: "auto",
    type: "string",
    description:
      "Default theme: 'auto' follows the visitor's OS setting, or 'light' or 'dark'. Visitors can flip it from the sidebar and their choice persists.",
  },
  favicon: {
    default: "",
    type: "string",
    description:
      "Vault-relative path to a favicon image (png/jpg/svg/webp). Empty generates one from the accent color.",
  },
  auto_image: {
    default: true,
    type: "boolean",
    description:
      "Fall back to a page's first embedded image when it has no 'image:' frontmatter. Used for social cards and Bases card covers.",
  },
  include_unknown_files: {
    default: false,
    type: "boolean",
    description:
      "Ship files with unrecognized extensions. Default false skips them with a warning, so a stray file cannot bypass role gating. Recognized media (audio, video, pdf, epub) is reference-gated either way.",
  },
  site_url: {
    default: "",
    type: "string",
    description:
      "Public base URL this vault is served from, e.g. 'https://notes.example.com'. Set it and the build writes sitemap.xml and robots.txt; leave it empty and neither is written. Only default-role pages are listed, so a sitemap cannot advertise gated ones.",
  },
  footer: {
    default: "Generated with [Wizzlethorpe Vaults](https://vaults.wizzlethorpe.com).",
    type: "string",
    description:
      "Markdown rendered in a <footer> on every page. Inline markdown works. Empty hides the footer.",
  },

};

export { SETTINGS_FILE } from "./paths.js";
import { SETTINGS_FILE, settingsPath } from "./paths.js";
import type { Addon } from "./addon.js";
import { installHint, loadAddon } from "./addons.js";

export interface LoadedSettings {
  values: Settings;
  /** Did the settings file exist on disk? If false, defaults were used. */
  exists: boolean;
  /** Was the on-disk version already canonical? If false, callers may want to write back. */
  changed: boolean;
  warnings: string[];
}

/**
 * Read the settings file from a vault, normalise its values against the
 * schema, fill defaults, and surface warnings for unknown keys.
 */
export async function loadSettings(vaultPath: string): Promise<LoadedSettings> {
  const addon = await loadAddon();
  const schema = mergedSchema(addon);
  let raw: string;
  try {
    raw = await readFile(settingsPath(vaultPath), "utf8");
  } catch {
    return { values: defaults(schema) as unknown as Settings, exists: false, changed: false, warnings: [] };
  }
  const { values, warnings } = normalize(loadYaml(raw), schema, addon);
  return { values, warnings, exists: true, changed: renderSettingsFile(values, schema) !== raw };
}

function mergedSchema(addon: Addon | undefined): Record<string, AnySettingDef> {
  return { ...SCHEMA, ...addon?.settingDefs };
}

/** Core's settings and the add-on's, in the order the file is written. */
export async function settingsSchema(): Promise<Record<string, AnySettingDef>> {
  return mergedSchema(await loadAddon());
}

/**
 * The schema pass: fill defaults and report anything the schema does not know.
 * Takes whatever a YAML (or, for the 0.22 migration, a frontmatter) parse produced.
 */
export async function normalizeSettings(input: unknown): Promise<{ values: Settings; warnings: string[] }> {
  const addon = await loadAddon();
  return normalize(input, mergedSchema(addon), addon);
}

function normalize(
  input: unknown, schema: Record<string, AnySettingDef>, addon: Addon | undefined,
): { values: Settings; warnings: string[] } {
  const fm = (isPlainObject(input) ? input : {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const values = defaults(schema);

  for (const [key, def] of Object.entries(schema)) {
    if (!Object.hasOwn(fm, key)) continue;
    const v = fm[key];
    if (!matchesType(v, def.type)) {
      warnings.push(`${SETTINGS_FILE}: '${key}' should be a ${def.type}, got ${describeType(v)}. Using default.`);
      continue;
    }
    if (def.choices && !def.choices.includes(v as string)) {
      warnings.push(
        `${SETTINGS_FILE}: '${key}' should be one of ${def.choices.join(", ")}, got '${String(v)}'. Using default.`,
      );
      continue;
    }
    values[key] = v;
  }

  addon?.checkSettings(values, warnings);

  // Kept, so a build without the add-on a vault was written for does not cost the vault its settings.
  for (const key of Object.keys(fm)) {
    if (Object.hasOwn(schema, key)) continue;
    // Defined, not assigned: assigning to a key named __proto__ would set the prototype and lose the key.
    Object.defineProperty(values, key, { value: fm[key], enumerable: true, writable: true, configurable: true });
    warnings.push(`${SETTINGS_FILE}: unknown setting '${key}' is ignored.${installHint(addon)}`);
  }

  return { values: values as unknown as Settings, warnings };
}

/**
 * Write the settings file to disk in canonical form. Used by `init`, by
 * `vaults set`, and by `build` whenever the on-disk file drifts.
 */
export async function writeSettings(vaultPath: string, values: Settings): Promise<void> {
  const path = settingsPath(vaultPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderSettingsFile(values, await settingsSchema()));
}

/** Cloned: the schema's defaults are module-level, and `vaults set` writes
 *  into the object this returns. */
function defaults(schema: Record<string, AnySettingDef>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).map(([k, def]) => [k, structuredClone(def.default)]));
}

function isPlainObject(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function matchesType(v: unknown, t: SettingType): boolean {
  if (t === "string[]") return Array.isArray(v) && v.every((item) => typeof item === "string");
  if (t === "object") return isPlainObject(v);
  if (t === "rules") {
    return Array.isArray(v) && v.every((item) =>
      isPlainObject(item)
      && typeof (item as Record<string, unknown>)["match"] === "string"
      // A plain object: `typeof` also admits null and arrays, which would pass
      // validation here and then supply nothing (or index keys) downstream.
      && isPlainObject((item as Record<string, unknown>)["data"]));
  }
  return typeof v === t;
}

export function describeType(v: unknown): string {
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function renderSettingsFile(values: Settings, schema: Record<string, AnySettingDef>): string {
  const lines: string[] = [
    "# Vault settings, managed by `vaults set`.",
    "# Hand edits survive, but the file is reformatted on the next build.",
    "# A key the CLI does not know is kept and ignored, without its comments.",
    "",
  ];
  for (const [key, def] of Object.entries(schema)) {
    lines.push(`# ${def.description}`);
    const value = (values as unknown as Record<string, unknown>)[key];
    if (def.type === "object") {
      const obj = (value ?? {}) as Record<string, unknown>;
      if (Object.keys(obj).length === 0) {
        lines.push(`${key}: {}`);
      } else {
        lines.push(`${key}:`);
        for (const line of dumpYaml(obj).trimEnd().split("\n")) lines.push(`  ${line}`);
      }
    } else if (def.type === "rules") {
      const rules = (value ?? []) as unknown[];
      if (rules.length === 0) {
        lines.push(`${key}: []`);
      } else {
        // Round-tripped through the YAML dumper rather than hand-formatted:
        // the value is arbitrarily nested frontmatter, and a bespoke printer
        // for it would be a second YAML implementation waiting to disagree
        // with the one that parsed it.
        lines.push(`${key}:`);
        for (const line of dumpYaml(rules).trimEnd().split("\n")) lines.push(`  ${line}`);
      }
    } else if (def.type === "string[]") {
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
  const unknown = Object.entries(values).filter(([key]) => !Object.hasOwn(schema, key));
  if (unknown.length > 0) lines.push(dumpYaml(Object.fromEntries(unknown)).trimEnd());
  while (lines[lines.length - 1] === "") lines.pop();
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
