// vfmc owns only the `packs` array of the module's module.json; every other key
// (esmodules, relationships, languages, styles, flags, …) is authored and
// maintained by the user in <vault>/foundry/module.json and preserved verbatim.
//
// Pack source declarations live in `flags.vfmc.packs`: one per Compendium
// subfolder vfmc compiles into a LevelDB pack.

/** A `flags.vfmc.packs[]` entry: which Compendium folder compiles to which pack. */
export interface PackDecl {
  /** Compendium subfolder under the vault (e.g. "Spells"). */
  folder: string;
  /** LevelDB pack name (e.g. "spells-wands"). */
  name: string;
  /** Compendium label shown in Foundry. */
  label: string;
  /** Foundry document type: "Item" | "Actor" | "RollTable" | … */
  type: string;
}

/** The module.json manifest. Loosely typed: vfmc only reads `id`/`flags.vfmc`
 *  and rewrites `packs`; everything else is opaque and preserved. */
export interface Manifest {
  id: string;
  system?: string;
  packs?: unknown[];
  flags?: { vfmc?: { packs?: PackDecl[] } } & Record<string, unknown>;
  [key: string]: unknown;
}

/** Build the top-level `packs` array Foundry reads, from the vfmc declarations. */
export function buildPacksArray(decls: PackDecl[], system?: string): Array<Record<string, unknown>> {
  return decls.map((p) => ({
    name: p.name,
    label: p.label,
    ...(system ? { system } : {}),
    path: `packs/${p.name}`,
    type: p.type,
  }));
}
