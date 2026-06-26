// vfmc owns only the `packs` array of the module's module.json; every other key
// (esmodules, relationships, languages, styles, flags, …) is authored and
// maintained by the user in <vault>/foundry/module.json and preserved verbatim.
//
// Pack source declarations live in `flags.vfmc.packs`: one per Compendium
// subfolder vfmc compiles into a LevelDB pack.
/** Build the top-level `packs` array Foundry reads, from the vfmc declarations. */
export function buildPacksArray(decls, system) {
    return decls.map((p) => ({
        name: p.name,
        label: p.label,
        ...(system ? { system } : {}),
        path: `packs/${p.name}`,
        type: p.type,
    }));
}
//# sourceMappingURL=manifest.js.map