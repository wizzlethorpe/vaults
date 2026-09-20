---
title: Foundry VTT integration
---

> [!note] Part of the TTRPG add-on
> Install `@wizzlethorpe/vaults-ttrpg` beside the CLI: `npm install -g @wizzlethorpe/vaults @wizzlethorpe/vaults-ttrpg`.

A deployed vault hands Foundry a file. Download your `grafts.json` from the vault, import it with [graft](https://github.com/wizzlethorpe/graft), and its content builds into your world: journals from the pages, Foundry document links from the wikilinks, images and audio into your data directory, and real Actors, Items, Scenes and other documents from pages that ask for them.

Nothing a vault ships is content the reader does not already own. A page that builds an Actor names a compendium document; the reader's Foundry resolves it, and the vault supplies only the patch.

```foundry-install
label: Add this vault to Foundry
note: Needs the Graft module
```

The box above is the `foundry-install` code block. It links to the reader's own entry list; the build requires `site_url` in `.vaults/settings.yaml` for the file to name the media it fetches.

## How a vault reaches Foundry

1. `vaults push` deploys the wiki and, inside each role's variant, a `grafts.json`: every page as a graft entry, with its rendered body inlined and its art listed in an `assets` block.
2. The reader downloads it. A gated vault serves whichever variant their sign-in entitles them to, and splices in a token good for two hours so graft can fetch the media the file names.
3. In Foundry, **Import grafts** on Graft's settings tab takes the file. Graft fetches the art into `vaults/<vault>/`, resolves each entry's source, and writes the documents into the world.
4. For newer content, download the file again and import it again. Entries carry deterministic ids, so a second import updates what it wrote the first time rather than adding a second copy.

## What is built

| Source | Foundry object |
|---|---|
| Each folder | One `JournalEntry` with one `JournalEntryPage` per `.md` page in it, foldered to match the vault |
| `image:` (or the discovered cover) | Downloaded into `vaults/<vault>/` |
| `[[Other Page]]` | `@UUID[JournalEntry.<entry>.JournalEntryPage.<page>]{label}` |
| Audio, PDFs, other passthroughs | Downloaded alongside images |
| `foundry.source: <UUID>` | A document of the UUID's type, built on that compendium document (see below) |
| `foundry.source: <Type>[:<subtype>]` | A blank `Actor`, `Item`, `Scene`, `JournalEntry`, `RollTable`, `Macro`, `Cards` or `Playlist` |
| `foundry.source: <file>.json` with `foundry.type: <Type>` | A document of that type, built on a file fetched to the reader's machine (see [Moulinette](#moulinette-assets-and-scenes-from-the-readers-own-library)) |
| `foundry.sync: false` | The page reaches neither the journal nor a document |
| `foundry.journal: false` | The page's document is built but the page gets no journal page |
| `foundry.embed: false` | The page's article is not written into its document's description |
| `foundry.folder` | A `/`-separated folder path the document files under, independent of where the page lives |
| `foundry.patch` | A deep-merge overlay on the document. `"@vault/PATH"` strings become the path the file lands at |
| `foundry.patch_json` | A vault-relative JSON file deep-merged into the document before `foundry.patch` |
| `foundry.patch._id` | A 16-character `[A-Za-z0-9]` id pinned for the document, instead of the derived one |

## Documents from `foundry.source`

Set `foundry.source` to a document UUID, usually a compendium document such as an SRD monster or magic item:

```yaml
---
title: Aelar Galanodel
image: aelar-portrait.webp
foundry:
  source: Compendium.dnd5e.monsters.Actor.O3ABqI55Ir1du1Xa
  patch:
    system:
      attributes:
        hp: { value: 22, max: 30 }
    prototypeToken:
      name: "Aelar (wounded)"
---
```

The build gives the page a **deterministic id**, a digest of the vault id and the page path, so a rebuild updates the same document. It layers the page's defaults over the source: `name` from the title, `img` from the cover image, the description from the page's rendered article. It then deep-merges `foundry.patch` on top, so HP and CR land where the sheet expects them. On the reader's machine graft resolves the UUID, applies the result, and writes the document into the world.

The result is an Actor or Item whose description is the wiki article.

> [!warning] The patch is authoritative
> Everything in `foundry.patch` is rewritten on every import, so an imported document never drifts from its page. Do not use it for sheets that change at the table, such as player characters.

### Blank documents

When no template exists in any compendium, name a type instead of a UUID:

```yaml
---
title: Joywraith
foundry:
  source: Actor:npc
  patch:
    system:
      attributes:
        hp: { value: 67, max: 67 }
        ac: { flat: 13, calc: natural }
      details:
        cr: 4
---
```

`Scene` makes a blank scene, `RollTable` a blank table, `Item:weapon` a blank weapon. The same id and patch rules apply, and a page that disappears leaves its document in the world, where you can delete it. Supported types: Actor, Item, Scene, JournalEntry, RollTable, Macro, Cards, Playlist. Subtypes are system-specific (dnd5e Actor: npc, character, vehicle, group; dnd5e Item: weapon, equipment, consumable, and so on). The bare type (`Actor`) takes the active system's default subtype.

[[Mossroot]] is a worked example: a blank `Actor:npc` whose statblock reads AC, HP, CR and speed through `fm:` from the same `foundry.patch` block, so one frontmatter block drives the wiki render and the Foundry sheet.

In this vault:
- [[Aelar]] builds on the SRD Scout
- [[Bram]] builds on the SRD Commoner
- [[Healing Potion]] builds on the SRD Potion of Healing
- [[Witchwood encounters]] is a blank `RollTable` whose results live in `foundry.patch.results` and render in the page body through `fm:`
- [[Mossfoot Tarot]] is a blank `Cards` deck of six `base` cards
- [[Mossfoot ambience]] is a blank `Playlist` whose sound `path` is an `@vault/` reference, so the audio plays from the file graft placed
- [[Mossfoot Great Hall]] is a blank `Scene` with a background, walls and one ambient sound, both files placed on disk through `@vault/`
- [[Toggle feast]], [[Toggle lights]] and [[Toggle ambient noise]] are `script` Macros that reach the Great Hall by its pinned `patch._id` and its placeables by their pinned `_id`s

![[screenshot-fvtt-actor-aelar-galanodel.webp|500]]

[[Aelar]] in dnd5e: the portrait from the vault, the page title as the document name, and HP 22/30 from the `foundry:` block.

---

![[screenshot-fvtt-item-potion-of-healing.webp|500]]

[[Healing Potion]] as a dnd5e item: the title from the page, the article as the description, and the `system.description.chat` override in the chat block.

---

### Starting from an exported JSON sheet

For a sheet that already exists as JSON (an export from another campaign, a community share), point `foundry.patch_json` at the file. The build deep-merges it into the document before `foundry.patch`, so the page can override single fields:

```yaml
---
title: Strahd von Zarovich
foundry:
  source: Actor:npc
  patch_json: sheets/strahd-export.json      # vault-relative
  patch:
    system:
      attributes:
        hp: { value: 144, max: 200 }         # over strahd-export.json
---
```

The build reads the JSON from disk and merges it into the entry, so changing the file changes what the next download builds. The file itself does not need to reach the deploy.

[[Aelar]] is the live demo: `Mossfoot/sheets/aelar-export.json` supplies biography, languages, skills and coin, and the page's `foundry.patch` adds the wound (HP 22/30), a CR bump and the "(wounded)" token name.

---

### Pinning an id with `patch._id`

A page's document id is a digest of the vault id and the page path: stable, but opaque, and hard to reference from a hotbar macro, a scene flag, or a hand-written `@UUID[…]`. Set `_id` in the patch to pin one:

```yaml
---
title: Mossfoot Great Hall
foundry:
  source: Scene
  patch:
    _id: mossfootHall0001
    name: Mossfoot Great Hall
---
```

[[Mossfoot Great Hall]] is the live demo. Once the grafts file is built, the scene sits in the world under that id, so a hotbar macro can run:

```javascript
game.scenes.get("mossfootHall0001").view();
```

The folder's `JournalEntry` id is shared by every page in that folder, so it cannot be pinned per page. Changing a pinned id between builds leaves anything already imported under the old id; delete it by hand.

---

## Moulinette: assets and scenes from the reader's own library

A vault can name content it does not ship. A scene, a map, a tile or a track from [Moulinette](https://assets.moulinette.cloud/) is fetched from **the reader's own Moulinette library** on their machine, through [graft-moulinette](https://github.com/wizzlethorpe/graft-moulinette). Nothing is redistributed; a reader without the subscription gets that entry skipped, or that one file missing, with the reason in the build report.

Requires the [Moulinette](https://foundryvtt.com/packages/moulinette) module, signed in, and graft-moulinette.

Anything of Moulinette's is named one way, by the pack number from the product's address bar and the asset's path inside that pack:

```
@moulinette/13648/json/scene/06-junkyard-empty.json
@moulinette/13648/images/maps/06-junkyard.webp
```

Write one as `foundry.source`, or as a whole value in `foundry.patch` or in the file `patch_json` names. A reference inside longer text, such as a description, is left as written, and one that is not a pack number and a path is reported by the build. The build replaces each one with a path under `graft/moulinette/` and lists the file for graft-moulinette to fetch to that path.

### Documents: whole scenes, journals and playlists

A `.json` asset is a document, and can be a page's source. Any source that is a path to a `.json` file works this way, whichever graft asset handler places it. A file in the vault cannot be a source, so an `@vault/` source is refused. A file does not say what kind of document it holds, so `foundry.type` does:

```yaml
foundry:
  source: "@moulinette/13648/json/scene/06-junkyard-empty.json"
  type: Scene
  patch:
    navName: Junkyard
```

### Files: maps, images and audio

Any other reference is a file, and goes wherever a path would:

```yaml
foundry:
  source: Scene
  patch_json: Scenes/tavern.json     # your dimensions, grid, walls, lights, levels
  patch:
    background:
      src: "@moulinette/13648/images/maps/06-junkyard.webp"
```

### Composing the scene yourself

Every Moulinette pack has a number, shown in its marketplace address. Creators re-export their catalogue for each Foundry generation as a **new pack with a new number**, often under the same name, so a pack number pins a Foundry version as well as content. A Foundry 13 scene imported into a Foundry 14 world keeps its walls, lights and sounds, but its map does not land where it belongs, because v14 moved a scene's background onto its Level. The build reports the mismatch and does not convert.

A file has no version. Compose the scene yourself and name only the art: you cannot redistribute a creator's map, and wall geometry and lighting are your own work and ship in the vault. See [[Battlemaps]] for the same pattern applied to layered maps.

## Getting content into your world

Everything lands in the world, foldered to match the vault. A page's role decides who can read its journal page: a `role: public` page is player-visible when `player_role` allows it, and a `role: dm` page is GM-only. The documents a page builds, its Actor or Item or Scene, are GM-only whatever the page's role; set `ownership` in `foundry.patch` to share one.

Graft never overwrites a document it did not write. One already in your world under the same id, put there by hand, stops that entry and is named in the report rather than replaced. A document graft did write is updated in place on the next import, so an edit you made to an imported NPC does not survive re-importing that page.

## Everything Foundry, under `foundry:`

A vault's Foundry settings live in `.vaults/settings.yaml`, in the same vocabulary a page uses for its own `foundry:` block:

```yaml
foundry:
  enabled: true           # false writes no grafts.json at all
  player_role: public     # highest role players may read; empty means none
  system: dnd5e           # the system your Actor and Item content targets
  core_version: '14.359'  # the full Foundry version your exported JSON came from
```

## `foundry.core_version`: what your document data is

Only matters if pages carry exported Scene or Actor JSON. Foundry's import refuses a document that records no version, and graft then builds a degraded copy in its place: a Scene arrives having lost every level it had, and nothing says so.

Set it to the full version you **exported from**, not the one you run, and quote it. Foundry migrates anything older; claiming to be current skips a migration old data needs.

A bare generation such as `'14'` is worse than leaving it unset: it sorts before every release in that generation, so Foundry runs migrations written for versions your data is already past. `migrateLevels` is one of them, and it replaces a Scene's levels outright.

## What players see inside a shared page

A player-visible page's journal body is the GM's render, with everything players may not see inside Foundry secret sections: role-gated callouts, embeds of pages above the player role, and the bases rows, cards and list items for those pages. A bases view is split rather than wrapped, because a secret cannot sit inside a table: players see the view with their own items, and the GM sees a second copy beneath it holding only the gated ones. A link to a page players cannot open still shows its title, as it does on the public wiki, and opens nothing for them. Foundry hides secret sections from anyone below owner, but the text is in the document data rather than absent from it. Treat it as obfuscation, and keep real secrets on `role: dm` pages.

A journal keeps no stylesheet, so the wiki's styles for callouts, bases and embeds are written into the page's HTML. Hover effects are the one part that does not carry over.

## Linking to the document instead of the page

A wikilink opens the page: its journal page, or its document when the page sets `journal: false`. When a page has both and you want the document (the Actor's statblock rather than their biography), use the inline handler:

```markdown
Run `fvtt-link: Toggle Feast` before the banquet.
See `fvtt-link: Bixby Wizzlethorpe|his statblock`.
```

On the wiki this renders as an ordinary link to the page. In Foundry it resolves to the document the page builds, falling back to the journal page for a page that builds none.

## Keeping a block out of Foundry

Any HTML element carrying the `vaults-web-only` class is stripped from the journal body Foundry receives; the wiki keeps it. The built-in battlemap viewer marks itself, since inside Foundry the Scene it previews is one click away. Use it on your own raw HTML for anything that only makes sense in a browser.

## `foundry.player_role`: what your players can read

Set it in `.vaults/settings.yaml` to the **highest role your Foundry players may read**. Journal pages at that role or below import with `OBSERVER` ownership; everything above stays GM-only. Empty, the default, makes none of the vault player-visible.

It governs journal pages only. An Actor, Item, Scene or any other document a page builds arrives GM-only, so a public NPC page does not hand players the NPC's statblock. To share one, say so in the page's patch:

```yaml
foundry:
  source: Actor:npc
  patch:
    ownership: { default: 2 }
```

```yaml
foundry:
  player_role: public
```

For a vault with roles `public`, `patron` and `dm` running that setting:

| Page | Role | Journal page ownership |
|---|---|---|
| [[Aelar]] | public | `default: OBSERVER` (players can read) |
| [[Witchwood Cult]] | patron | GM-only |
| [[Hidden Caves]] | dm | GM-only |

Set it to `patron` and the middle row becomes player-visible too. This vault leaves it empty, so nothing here is player-visible.

### Role-gated callouts inside player-visible pages

[[Aelar]] is `role: public`, so its journal page imports player-visible, but it holds `[!dm]` and `[!patron]` callouts. Each becomes its own Foundry secret section. The GM sees the whole page with those callouts marked as secrets, and can show one to players with its REVEAL toggle; a player with Observer ownership sees the page without them.

![[screenshot-fvtt-journal-bram-mossfoot.webp|500]]

[[Bram]]'s journal as the GM sees it, with the DM-only material inside the dimmed secret block.

An Actor or Item description is the same rendered article with the same secret sections, which matters once a patch has shared that document.

Changing `foundry.player_role` changes ownership and the bodies; push, then download and import again. Documents already built are updated in place.

> [!warning] Secrets on player-owned documents
> Foundry does not hide secret sections on a document owned by a non-GM user. Imported journal entries default to GM ownership with Observer access for players, so this rarely applies to them. It does apply when you change ownership, or when a page's article is embedded in an Actor or Item sheet a player owns.

For a page whose article should not appear in its Actor or Item sheet at all, set `foundry.embed: false`. The document is still built with its name, image and `foundry.patch`; only the description is left as the template had it.

---

## Keeping a page out of Foundry with `foundry.sync: false`

Every page in a built variant becomes a `JournalEntryPage` unless it opts out. Use `sync: false` for toolchain notes, build documentation and drafts.

```yaml
---
title: Toolchain reference
foundry:
  sync: false
---
```

The page still renders on the wiki. It never reaches Foundry: no journal page, and no document even if the page declares a `foundry.source`. Wikilinks to it from other pages stay as ordinary links to the wiki rather than dangling `@UUID[…]` enrichers.

> [!warning] Not the same as `embed: false`
> `foundry.embed: false` only keeps the article out of a document's description; the journal page is still built. `foundry.sync: false` keeps the page out altogether.

Setting the flag on a page that has already been imported leaves its journal page and document in the world; delete them there if you no longer want them.

The alternative is `ignore:` in `.vaults/settings.yaml`, which drops the page from the build entirely, so it reaches neither the wiki nor Foundry. Use `ignore:` for files that are not content. Use `foundry.sync: false` for pages that belong on the wiki only.
