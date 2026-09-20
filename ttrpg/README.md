# vaults-ttrpg

The TTRPG add-on for [`@wizzlethorpe/vaults`](https://www.npmjs.com/package/@wizzlethorpe/vaults). Install it beside the CLI and a vault gains:

- **`statblock`** code blocks: D&D 5e creature statblocks from YAML.
- **`` `dice:` ``** inline buttons that roll in the browser.
- **`battlemap`** code blocks: layered, multi-level maps with a grid toggle.
- **Foundry VTT import.** Each role's pages compile into a self-contained `grafts.json` that a reader downloads and builds into their world with [graft](https://foundryvtt.com/packages/graft). `foundry:` page frontmatter turns a page into an Actor, Item, Scene or other document. The `foundry-install` block and `` `fvtt-link:` `` handler go with it.

## Install

```bash
npm install -g @wizzlethorpe/vaults @wizzlethorpe/vaults-ttrpg
```

Nothing in the vault names the add-on. The CLI looks for it when it runs, and uses it if it is there. The two release together at one version and the CLI refuses an add-on at any other, so install and update them in one command, as above.

A vault built where the add-on is missing still builds. Its `foundry` and `zip_assets` settings are kept in `.vaults/settings.yaml` and ignored with a warning, `statblock` and the other blocks render as plain code, and no `grafts.json` is written.

## Handlers

- `` `dice: 1d20+5` `` renders as a button that rolls on click. Mirrors [Obsidian Dice Roller](https://github.com/javalent/dice-roller) syntax.
- A `statblock` block takes a creature as YAML and renders a 5e statblock. `dice:` and `fm:` work inside its fields.
- A `battlemap` block lists levels, each a stack of image layers, with an optional grid. A layer nothing else embeds still ships with the page.
- A `foundry-install` block renders the download link and import steps for the reader's own `grafts.json`.
- `` `fvtt-link: Page` `` links to a page on the wiki and to the document that page builds in Foundry.

## Page frontmatter

```yaml
---
foundry:
  source: Compendium.dnd5e.monsters.Actor.bandit   # a document to start from, or Type[:subtype] for a blank one
  patch:                                           # merged over it
    system.attributes.hp.value: 22
---
```

A page with a `foundry.source` builds that document in the reader's world, with the page as its journal entry. A source that is a `.json` file on the reader's machine, such as `@moulinette/13648/json/scene/junkyard.json` with [graft-moulinette](https://github.com/wizzlethorpe/graft-moulinette), does not say what kind of document it holds, so `foundry.type: Scene` does. `image:` frontmatter, or the page's first image, becomes the document's art.

## The reader's download

Each role's variant holds `_foundry/grafts.json`, and a multi-role deploy serves it at `/_foundry/grafts.json` as the caller's own role's copy, with a two-hour bearer written into its `assets` block so graft can fetch the media it names.

## Settings

The add-on contributes two settings to `.vaults/settings.yaml`, set with `vaults set`:

- `foundry`: `enabled`, `player_role`, `system` and `core_version`. `vaults set foundry.enabled false` keeps the handlers and writes no `grafts.json`.
- `zip_assets`: batch each role's Foundry media into zips of at most this many MiB.

Documentation and a live demo of every feature: [vaults.wizzlethorpe.com](https://vaults.wizzlethorpe.com).
