// The settings the add-on contributes, and the checks the generic schema pass cannot make.

import { type AnySettingDef, describeType, PAGES_FILE_BYTES, type Settings, SETTINGS_FILE } from "@wizzlethorpe/vaults/addon";

/**
 * Everything this vault says about Foundry, under one key.
 *
 * Named the way a page names it: `foundry:` in frontmatter already means "the
 * Foundry facts about this thing".
 */
interface FoundrySettings {
  /** Whether the build writes the grafts.json a reader imports. */
  enabled: boolean;
  /** Highest role players may read; "" means none of it is player-visible. */
  player_role: string;
  /**
   * Foundry version the vault's exported document data was authored at, e.g.
   * "14". Empty means unstated.
   */
  core_version: string;
  /** Game system the vault's Actor and Item content targets, e.g. "dnd5e". */
  system: string;
}

const FOUNDRY_DEFAULTS: FoundrySettings = {
  enabled: true,
  player_role: "",
  core_version: "",
  system: "dnd5e",
};

/** A vault's settings as the add-on reads them. */
export type TtrpgSettings = Settings & { zip_assets: number; foundry: FoundrySettings };

export const TTRPG_SETTINGS: Record<string, AnySettingDef> = {
  zip_assets: {
    default: 25,
    type: "number",
    description:
      "Also ship each role's Foundry assets as zips of at most this many MiB, so a first import is a few downloads instead of hundreds. 0 turns it off. At most 25, Cloudflare Pages' per-file limit. Smaller zips mean a rebuild that changes one file drags fewer others along.",
  },
  foundry: {
    default: FOUNDRY_DEFAULTS,
    type: "object",
    description:
      "Foundry VTT integration. "
      + "'enabled': write the grafts.json a reader downloads and imports into their world. "
      + "'player_role': the highest role players may read. Journal pages at or below it arrive player-visible; empty (the default) means none are. Documents a page builds, such as Actors and Items, are GM-only whatever the role, unless the page's foundry.patch sets their ownership. "
      + "'system': the game system your Actor and Item content targets, e.g. dnd5e. "
      + "'core_version': the full quoted Foundry version your exported Scene / Actor JSON came from, e.g. '14.359'. A bare '14' sorts before every release in that generation and costs a Scene its levels."
  },
};

export function normalizeTtrpgSettings(values: Record<string, unknown>, warnings: string[]): void {
  normalizeFoundry(values, warnings);
  const zip = values["zip_assets"] as number;
  if (zip < 0 || zip * 1024 * 1024 > PAGES_FILE_BYTES) {
    warnings.push(`${SETTINGS_FILE}: 'zip_assets' must be between 0 and 25 MiB, got ${zip}. Using 0.`);
    values["zip_assets"] = 0;
  }
}

/**
 * Check and fill in the `foundry` block. The generic check only asks whether it
 * is an object; a misspelled subkey would otherwise read as an unset default.
 * Missing keys take their defaults, so a vault only states what it changes.
 */
function normalizeFoundry(values: Record<string, unknown>, warnings: string[]): void {
  const raw = (values["foundry"] ?? {}) as Record<string, unknown>;
  const unknown = Object.entries(raw).filter(([key]) => !Object.hasOwn(FOUNDRY_DEFAULTS, key));
  for (const [key] of unknown) {
    warnings.push(
      `${SETTINGS_FILE}: unknown key 'foundry.${key}' is ignored. Known: ${Object.keys(FOUNDRY_DEFAULTS).join(", ")}.`,
    );
  }

  const enabled = raw["enabled"];
  if (enabled !== undefined && typeof enabled !== "boolean") {
    warnings.push(`${SETTINGS_FILE}: 'foundry.enabled' should be true or false, got ${describeType(enabled)}.`);
  }
  const role = raw["player_role"];
  if (role !== undefined && typeof role !== "string") {
    warnings.push(`${SETTINGS_FILE}: 'foundry.player_role' should be a role name, got ${describeType(role)}.`);
  }
  const core = raw["core_version"];
  if (core !== undefined && typeof core !== "string" && typeof core !== "number") {
    warnings.push(`${SETTINGS_FILE}: 'foundry.core_version' should be a Foundry version like 14.359, got ${describeType(core)}.`);
  } else if (typeof core === "number") {
    // YAML reads an unquoted 14.350 as the number 14.35, which is a different
    // version, and 14 as a generation. Quoting is the only way to say either
    // one exactly.
    warnings.push(
      `${SETTINGS_FILE}: 'foundry.core_version' is unquoted, so YAML read it as the number ${core}.`
      + ` Quote it, as '14.359': unquoted, a trailing zero is lost and a bare generation is ambiguous.`);
  } else if (typeof core === "string" && /^\d+$/.test(core.trim())) {
    // A bare generation sorts before every patch-level migration inside it, so
    // Foundry treats the data as older than anything released that generation
    // and runs migrations written for the generation before. `14` is how a
    // Scene loses its levels: `migrateLevels` is registered at 14.353 and
    // rebuilds `levels` from a v13 root background that a v14 export does not
    // have.
    warnings.push(
      `${SETTINGS_FILE}: 'foundry.core_version' is '${String(core)}', a generation rather than a version.`
      + ` Foundry sorts that before every release in it and runs migrations your data is already past,`
      + ` which costs a Scene its levels. Use the full version you exported from, e.g. 14.359.`);
  }
  const sys = raw["system"];
  if (sys !== undefined && typeof sys !== "string") {
    warnings.push(`${SETTINGS_FILE}: 'foundry.system' should be a system id like dnd5e, got ${describeType(sys)}.`);
  }
  // Unknown subkeys are kept, like a top-level key core does not know.
  values["foundry"] = {
    enabled: typeof enabled === "boolean" ? enabled : FOUNDRY_DEFAULTS.enabled,
    player_role: typeof role === "string" ? role : FOUNDRY_DEFAULTS.player_role,
    system: typeof sys === "string" && sys ? sys : FOUNDRY_DEFAULTS.system,
    core_version: typeof core === "string" ? core
      : typeof core === "number" ? String(core) : FOUNDRY_DEFAULTS.core_version,
    ...Object.fromEntries(unknown),
  };
}
