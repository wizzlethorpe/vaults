import { readFile, writeFile } from "node:fs/promises";
import { dump as dumpYaml } from "js-yaml";
import { join } from "node:path";
import matter from "gray-matter";

// Single source of truth for user-editable settings: name, type, default,
// description. To add a setting, add a line here. The schema drives parsing,
// normalisation, the init template, and the warning for unknown keys.
//
// Auth config (roles, role_passwords, oauth providers) lives in
// .vaults/config.json instead, with secrets mirrored to .vaults/.env.
// CLI-managed (`vaults role add/remove/promote/demote`, `vaults password`,
// `vaults patreon …`); shouldn't be hand-edited or git-tracked.
export interface Settings {
  vault_name: string;
  image_quality: number;
  max_file_bytes: number;
  ignore: string[];
  default_frontmatter: FrontmatterRule[];
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
  foundry: FoundrySettings;
  footer: string;
  site_url: string;
}

type SettingType = "string" | "number" | "boolean" | "string[]" | "rules" | "object";

/**
 * How a vault's content is packaged for Foundry, which decides both what a
 * sync produces and what `build --module` compiles.
 *
 * The two are different products, and the difference is not cosmetic: an
 * adventure's internal links must resolve to the copies the GM imported, so
 * they are world UUIDs and Foundry's Adventure import remaps nothing (it
 * creates with keepId and updates what already exists). A compendium's links
 * name the packs, because nothing is ever imported as a unit and the pack copy
 * is the copy. Baking one shape and using it the other way is what leaves a
 * page pointing at a second copy of the thing beside it.
 */
export type FoundryPackage = "none" | "compendium" | "adventure";

/**
 * Everything this vault says about Foundry, under one key.
 *
 * Named the way a page names it. `foundry:` in frontmatter already means "the
 * Foundry facts about this thing", and three `foundry_*` scalars scattered
 * through settings.md were the same idea spelled differently.
 */
export interface FoundrySettings {
  /** How the vault is packaged: browsable packs, one Adventure, or nothing. */
  package: FoundryPackage;
  /** Highest role players may read; "" means none of it is player-visible. */
  player_role: string;
  /**
   * Foundry version the vault's exported document data was authored at, e.g.
   * "14". Empty means unstated.
   */
  core_version: string;
  /** Game system the vault's Actor and Item content targets, e.g. "dnd5e". */
  system: string;
  /** Extra keys merged into the generated module.json. */
  module: Record<string, unknown>;
}

export const FOUNDRY_DEFAULTS: FoundrySettings = {
  package: "compendium",
  player_role: "",
  core_version: "",
  system: "dnd5e",
  module: {},
};

const FOUNDRY_PACKAGES: FoundryPackage[] = ["none", "compendium", "adventure"];

interface SettingDef<K extends keyof Settings> {
  default: Settings[K];
  type: SettingType;
  description: string;
  /** For a string setting with a fixed vocabulary; anything else is rejected. */
  choices?: readonly string[];
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

const SCHEMA: { [K in keyof Settings]: SettingDef<K> } = {
  vault_name: {
    default: "Vault",
    type: "string",
    description: "Display name for the wiki. Shown in the header and in page titles.",
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
      "Fall back to a page's first embedded image when it has no 'image:' frontmatter. Used for social cards, Bases card covers, and Foundry art.",
  },
  include_unknown_files: {
    default: false,
    type: "boolean",
    description:
      "Ship files with unrecognized extensions. Default false skips them with a warning, so a stray file cannot bypass role gating. Recognized media (audio, video, pdf, epub) is reference-gated either way.",
  },
  foundry: {
    default: FOUNDRY_DEFAULTS,
    type: "object",
    description:
      "Foundry VTT integration. "
      + "'package': 'adventure' ships the vault as one Adventure document you import once, 'compendium' (the default) as browsable packs, one per document type, 'none' ships nothing. "
      + "'player_role': the highest role players may read. Pages at or below it arrive player-visible; empty (the default) means none are. "
      + "'system': the game system your Actor and Item content targets, e.g. dnd5e. "
      + "'core_version': the full quoted Foundry version your exported Scene / Actor JSON came from, e.g. '14.359'. A bare '14' sorts before every release in that generation and costs a Scene its levels. "
      + "'module': extra keys merged into the module.json the vault serves, such as 'authors'."
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
import { SETTINGS_FILE } from "./paths.js";

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
    if (def.choices && !def.choices.includes(v as string)) {
      warnings.push(
        `settings.md: '${key}' should be one of ${def.choices.join(", ")}, got '${String(v)}'. Using default.`,
      );
      continue;
    }
    (values as unknown as Record<string, unknown>)[key] = v;
  }

  normalizeFoundry(values, warnings);

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

function isPlainObject(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Check and fill in the `foundry` block.
 *
 * The generic type check only asks whether it is an object, and every key
 * inside it means something: an unrecognised `package` would silently pick a
 * delivery shape the author did not ask for, with links baked to match, and a
 * misspelled subkey would read as an unset default rather than as a mistake.
 * Missing keys take their defaults, so a vault only states what it changes.
 */
function normalizeFoundry(values: Settings, warnings: string[]): void {
  const raw = (values.foundry ?? {}) as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(key in FOUNDRY_DEFAULTS)) {
      warnings.push(
        `settings.md: unknown key 'foundry.${key}'. Known: ${Object.keys(FOUNDRY_DEFAULTS).join(", ")}.`,
      );
    }
  }

  const pkg = raw["package"];
  if (pkg !== undefined && !FOUNDRY_PACKAGES.includes(pkg as FoundryPackage)) {
    warnings.push(
      `settings.md: 'foundry.package' should be one of ${FOUNDRY_PACKAGES.join(", ")}, `
      + `got '${String(pkg)}'. Using '${FOUNDRY_DEFAULTS.package}'.`,
    );
  }
  const role = raw["player_role"];
  if (role !== undefined && typeof role !== "string") {
    warnings.push(`settings.md: 'foundry.player_role' should be a role name, got ${describeType(role)}.`);
  }
  const core = raw["core_version"];
  if (core !== undefined && typeof core !== "string" && typeof core !== "number") {
    warnings.push(`settings.md: 'foundry.core_version' should be a Foundry version like 14.359, got ${describeType(core)}.`);
  } else if (typeof core === "number") {
    // YAML reads an unquoted 14.350 as the number 14.35, which is a different
    // version, and 14 as a generation. Quoting is the only way to say either
    // one exactly.
    warnings.push(
      `settings.md: 'foundry.core_version' is unquoted, so YAML read it as the number ${core}.`
      + ` Quote it, as '14.359': unquoted, a trailing zero is lost and a bare generation is ambiguous.`);
  } else if (typeof core === "string" && /^\d+$/.test(core.trim())) {
    // A bare generation sorts before every patch-level migration inside it, so
    // Foundry treats the data as older than anything released that generation
    // and runs migrations written for the generation before. `14` is how a
    // Scene loses its levels: `migrateLevels` is registered at 14.353 and
    // rebuilds `levels` from a v13 root background that a v14 export does not
    // have.
    warnings.push(
      `settings.md: 'foundry.core_version' is '${String(core)}', a generation rather than a version.`
      + ` Foundry sorts that before every release in it and runs migrations your data is already past,`
      + ` which costs a Scene its levels. Use the full version you exported from, e.g. 14.359.`);
  }
  const sys = raw["system"];
  if (sys !== undefined && typeof sys !== "string") {
    warnings.push(`settings.md: 'foundry.system' should be a system id like dnd5e, got ${describeType(sys)}.`);
  }
  const module = raw["module"];
  if (module !== undefined && !isPlainObject(module)) {
    warnings.push(`settings.md: 'foundry.module' should be a manifest object, got ${describeType(module)}.`);
  }

  values.foundry = {
    package: FOUNDRY_PACKAGES.includes(pkg as FoundryPackage)
      ? pkg as FoundryPackage : FOUNDRY_DEFAULTS.package,
    player_role: typeof role === "string" ? role : FOUNDRY_DEFAULTS.player_role,
    system: typeof sys === "string" && sys ? sys : FOUNDRY_DEFAULTS.system,
    core_version: typeof core === "string" ? core
      : typeof core === "number" ? String(core) : FOUNDRY_DEFAULTS.core_version,
    module: isPlainObject(module) ? module as Record<string, unknown> : {},
  };
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

function describeType(v: unknown): string {
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function renderSettingsFile(values: Settings): string {
  const lines: string[] = ["---"];
  for (const [key, def] of Object.entries(SCHEMA) as [keyof Settings, SettingDef<keyof Settings>][]) {
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
