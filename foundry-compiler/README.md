# @wizzlethorpe/foundry-compiler

`vfmc` — the **v**aults **f**oundry **m**odule **c**ompiler. Compiles a
[wizzlethorpe vault](../) into the Foundry VTT module that lives at
`<vault>/foundry/`.

`vfmc` writes the LevelDB compendium packs and **owns only the `packs` array** of
`module.json`. Everything else in that directory — custom esmodules, styles,
`lang/` UI strings, Babele translation files, and every other `module.json` key
(relationships, languages, flags) — is authored and maintained by you, and is
preserved across recompiles. So `<vault>/foundry/` is a normal, extensible
Foundry module you own; `vfmc` just keeps its compendiums in sync with the vault.

The `vaults` CLI (`../cli`) is Foundry-agnostic; the `vaults` Foundry module
(`../foundry`) syncs a vault into a *live world*. This is the third leg: bake a
vault's `foundry.base` content into an *installable module*. All three are
lockstep-versioned via the monorepo's `release.sh`.

## Input

- `<vault>/foundry/module.json` with `flags.vfmc.packs` — one entry per compendium
  pack: `{ folder, name, label, type }` (which `Compendium/<folder>/` compiles to
  which pack). `id` and the optional `system` are read from here too.
- `<vault>/Compendium/<folder>/` pages with `foundry: { base, id, data_json, folder }`
  frontmatter and `*.foundry.json` sidecars (roll tables carry inline `foundry.data`).

## Output (in place)

```
<vault>/foundry/
├── module.json      ← `packs` array rewritten; all other keys preserved
└── packs/<name>/    ← LevelDB, rewritten
```

Pass `--out <dir>` to write a copy elsewhere instead of in place.

### How content maps

- Page body markdown → the document's description HTML, dropping fenced handler
  blocks (```spell-card```, ```statblock-fm```, ```rolltable```), rewriting
  `` `dice: 2d6` `` → `[[/r 2d6]]`, and `[[Wikilinks]]` → `@UUID[Compendium.…]`.
- **Folders**: a doc's compendium folder is its `foundry.folder` frontmatter
  (override) or its subfolder path under `Compendium/<folder>/`. Nested via "/".
- Babele / custom JS / styles / UI lang: **not generated** — you keep them in
  `<vault>/foundry/` and `vfmc` leaves them untouched.

## Install

From the monorepo root (`vaults/`):

```bash
pnpm install
pnpm --filter @wizzlethorpe/foundry-compiler run build
pnpm --filter @wizzlethorpe/foundry-compiler link --global   # puts `vfmc` on PATH
```

The bundled Foundry CLI (`@foundryvtt/foundryvtt-cli`) is resolved from this
package's own dependencies, so `vfmc` works from any directory.

## Usage

```bash
vfmc <vaultPath> [--out <dir>]

# e.g. compile WANDS in place into WANDS/foundry/
vfmc ~/projects/wizzlethorpe/WANDS
```
