---
title: Foundry VTT integration
---

A deployed vault is also a Foundry VTT module. The **Wizzlethorpe Vaults** Foundry module, built on [graft](https://github.com/wizzlethorpe/graft), reads the vault's deploy and builds its content on the reader's machine: journals from the pages, Foundry document links from the wikilinks, images and audio into the world's data directory, and real Actors, Items, Scenes and other documents from pages that ask for them. What it builds depends on `foundry.package` in `settings.md`: **compendium** packs, one per document type, or one **Adventure** document.

Nothing a vault ships is content the reader does not already own. A page that builds an Actor names a compendium document; the reader's Foundry resolves it, and the vault supplies only the patch.

```foundry-install
label: Install this vault in Foundry
note: Needs the Graft and Wizzlethorpe Vaults modules
```

The box above is the `foundry-install` code block. It shows the vault's own install link and copies it; the build requires `site_url` in `settings.md` to write the module it points at.

## How a vault reaches Foundry

1. `vaults push` deploys the wiki and, beside it, `_foundry/module.json`: a module for the vault holding a manifest, its pack declarations, and one line naming the deploy. It contains no content.
2. The reader installs the vault's module from that link. It requires Graft and Wizzlethorpe Vaults, both in Foundry's package directory, so Foundry offers to install and enable them alongside it.
3. Wizzlethorpe Vaults offers to build. It fetches the vault's entry list and page bodies, downloads images and audio into `worlds/<world>/vaults-cache/<deploy>/<role>/`, and hands the entries to graft, which resolves each source and writes the packs.
4. A role-gated vault asks the reader to connect first: open the vault's `/connect` page, sign in, approve access for Foundry VTT, and paste the token back. The build reads the vault at that role. **Reconnect Vault**, in the header of any of the vault's compendium windows, forgets the token and the cache and offers to build again, which is how a reader changes role.
5. On later world loads the module compares the deploy's content hash with the last build and offers a rebuild when the vault has changed. Pushing new content never means reinstalling anything.

## What is built

| Source | Foundry object |
|---|---|
| Each folder | One `JournalEntry` with one `JournalEntryPage` per `.md` page in it, foldered to match the vault |
| `image:` (or the discovered cover) | Downloaded into the world's vault cache |
| `[[Other Page]]` | `@UUID[Compendium.<vault>.<vault>-journals.JournalEntry.<entry>.JournalEntryPage.<page>]{label}`, or a world UUID under Adventure packaging |
| Audio, PDFs, other passthroughs | Downloaded alongside images |
| `foundry.source: <UUID>` | A document of the UUID's type, built on that compendium document (see below) |
| `foundry.source: <Type>[:<subtype>]` | A blank `Actor`, `Item`, `Scene`, `JournalEntry`, `RollTable`, `Macro`, `Cards` or `Playlist` |
| `foundry.source: [<UUID>, …]` | A list tried in order, so one page serves readers with different content installed |
| `foundry.sync: false` | The page reaches neither the journal nor a document |
| `foundry.journal: false` | The page's document is built but the page gets no journal page |
| `foundry.embed: false` | The page's article is not written into its document's description |
| `foundry.folder` | A `/`-separated folder path the document files under, independent of where the page lives |
| `foundry.patch` | A deep-merge overlay on the document. `"@vault/PATH"` strings become vault-cache URLs |
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

The build gives the page a **deterministic id**, a digest of the vault id and the page path, so a rebuild updates the same document. It layers the page's defaults over the source: `name` from the title, `img` from the cover image, the description from the page's rendered article. It then deep-merges `foundry.patch` on top, so HP and CR land where the sheet expects them. On the reader's machine graft resolves the UUID, applies the result, and writes the document into the vault's pack.

The result is an Actor or Item whose description is the wiki article. Documents you import into the world are yours: a rebuild rewrites the pack, not your copy.

> [!warning] The patch is authoritative
> Everything in `foundry.patch` is rewritten on every build, so a pack document never drifts from its page. Do not use it for sheets that change at the table, such as player characters.

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

`Scene` makes a blank scene, `RollTable` a blank table, `Item:weapon` a blank weapon. The same id and patch rules apply, and a page that disappears takes its document out of the pack on the next build. Supported types: Actor, Item, Scene, JournalEntry, RollTable, Macro, Cards, Playlist. Subtypes are system-specific (dnd5e Actor: npc, character, vehicle, group; dnd5e Item: weapon, equipment, consumable, and so on). The bare type (`Actor`) takes the active system's default subtype.

[[Mossroot]] is a worked example: a blank `Actor:npc` whose statblock reads AC, HP, CR and speed through `fm:` from the same `foundry.patch` block, so one frontmatter block drives the wiki render and the Foundry sheet.

In this vault:
- [[Aelar]] builds on the SRD Scout
- [[Bram]] builds on the SRD Commoner
- [[Healing Potion]] builds on the SRD Potion of Healing
- [[Witchwood encounters]] is a blank `RollTable` whose results live in `foundry.patch.results` and render in the page body through `fm:`
- [[Mossfoot Tarot]] is a blank `Cards` deck of six `base` cards
- [[Mossfoot ambience]] is a blank `Playlist` whose sound `path` is an `@vault/` reference, so the audio plays from the vault cache
- [[Mossfoot Great Hall]] is a blank `Scene` with a background, walls and one ambient sound, both files pulled into the vault cache through `@vault/`
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

The build reads the JSON from disk and merges it into the entry, so changing the file moves the vault's content hash and prompts a rebuild. The file itself does not need to reach the deploy.

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

[[Mossfoot Great Hall]] is the live demo. After the scene is imported with **Keep Document IDs**, a hotbar macro can run:

```javascript
game.scenes.get("mossfootHall0001").view();
```

To reach the copy still in the pack, name the pack:

```javascript
await fromUuid("Compendium.<vault-id>.<vault-id>-scenes.Scene.mossfootHall0001");
```

The folder's `JournalEntry` id is shared by every page in that folder, so it cannot be pinned per page. Changing a pinned id between builds leaves anything already imported under the old id; delete it by hand.

---

## Moulinette: assets and scenes from the reader's own library

A vault can name content it does not ship. A source that names a scene or a track from [Moulinette](https://assets.moulinette.cloud/) resolves against **the reader's own Moulinette library** on their machine, through [graft-moulinette](https://github.com/wizzlethorpe/graft-moulinette). Nothing is redistributed; a reader without the subscription gets that entry skipped, with the reason in the build report.

Requires the [Moulinette](https://foundryvtt.com/packages/moulinette) module, signed in, and graft-moulinette, which documents this fully.

### Documents: whole scenes, journals and playlists

A Moulinette document is named the way its marketplace page reads: the document kind, the pack number from the product's address bar, and the asset's path inside that pack.

```yaml
foundry:
  source:
    - Compendium.mad-taverns.mad-taverns-maps.Scene.F3wyDaiec72h5sFG
    - "@moulinette/Scene/13648/json/scene/06-junkyard-empty.json"
  patch:
    navName: Junkyard
```

The build reads the document type from the first source, so a Moulinette name goes after a compendium UUID. On the reader's machine graft-moulinette materialises the named document into a pack of its own before graft tries the list, so the list behaves as any other: the compendium copy if the reader has that module, otherwise the Moulinette copy, otherwise a skipped entry with a reason. A compendium copy is the better first choice where a creator offers one: Foundry migrates compendium packs on load, which a raw Moulinette import skips.

### Files: maps, images and audio

A file is named by the path Moulinette downloads it to, and graft-moulinette fetches whatever the reader is missing after the build:

```yaml
foundry:
  source: Scene
  patch_json: Scenes/tavern.json     # your dimensions, grid, walls, lights, levels
```

with the map named inside that file as `moulinette-v2/cloud/<creator>/<pack>/images/maps/06-junkyard.webp`. Import the asset once in Foundry and copy the path off the document; the folder is the creator's own and the marketplace URL only shows a slug of it.

### Composing the scene yourself

Creators re-export their catalogue for each Foundry generation as a **new pack with a new number**, often under the same name, so a pack number pins a Foundry version as well as content. A Foundry 13 scene imported into a Foundry 14 world keeps its walls, lights and sounds, but its map does not land where it belongs, because v14 moved a scene's background onto its Level. The build reports the mismatch and does not convert.

A file has no version. Compose the scene yourself and name only the art: you cannot redistribute a creator's map, and wall geometry and lighting are your own work and ship in the vault. See [[Battlemaps]] for the same pattern applied to layered maps.

## Packs, and getting content into your world

Under `package: compendium` a vault builds into its own packs, one per document type, all eight declared whether or not the vault uses them, grouped in a sidebar folder named after the vault:

```
Compendium Packs
└── Marlo Mystery
    ├── Marlo Mystery: Journals
    ├── Marlo Mystery: Actors
    ├── Marlo Mystery: Items
    ├── Marlo Mystery: Scenes
    ├── Marlo Mystery: Tables
    ├── Marlo Mystery: Macros
    ├── Marlo Mystery: Playlists
    └── Marlo Mystery: Cards
```

To bring content across, right-click a pack and choose **Import All**, or drag individual documents out. The documents become yours: a later build updates the pack and leaves what you imported alone.

> [!tip] Check "Keep Document IDs"
> Import All offers it. Vault documents have derived ids, and keeping them is what lets cross-references survive the trip: a scene's map note finds its article, a macro finds its scene, and a re-import updates what you already brought over instead of adding a second copy.

**Vault packs are declared GM-only** in the vault's `module.json`, whatever the vault's roles. Foundry gates compendium visibility per pack and per user role, with no per-document filter, so a pack a player could open would show them every name and image in it. Per-page roles take effect on import instead: Import All preserves each document's ownership, so a `role: public` page lands player-visible when `player_role` allows it and a `role: dm` page lands GM-only. Dragging a single document out is the exception: Foundry clears ownership on that path, and the document arrives GM-only whatever its role.

Under `package: adventure` the vault builds one Adventure document, named after the vault, in a single pack. Import it once and every internal link resolves to the copies you imported; a second import updates them in place, since the ids are deterministic. Folders travel with it.

## Everything Foundry, under `foundry:`

A vault's Foundry settings live in `settings.md`, in the same vocabulary a page uses for its own `foundry:` block:

```yaml
foundry:
  package: compendium     # none | compendium | adventure
  player_role: public     # highest role players may read; empty means none
  system: dnd5e           # the system your Actor and Item content targets
  core_version: '14.359'  # the full Foundry version your exported JSON came from
  module:                 # optional; extra keys for the module.json served
    authors:
      - name: You
```

## `foundry.core_version`: what your document data is

Only matters if pages carry exported Scene or Actor JSON. Foundry's import refuses a document that records no version, and graft then builds a degraded copy in its place: a Scene arrives having lost every level it had, and nothing says so.

Set it to the full version you **exported from**, not the one you run, and quote it. Foundry migrates anything older; claiming to be current skips a migration old data needs.

A bare generation such as `'14'` is worse than leaving it unset: it sorts before every release in that generation, so Foundry runs migrations written for versions your data is already past. `migrateLevels` is one of them, and it replaces a Scene's levels outright.

## What players see inside a shared page

A player-visible page's journal body carries two renders: the GM's full page inside a Foundry secret section, and the player variant's render in the open. Foundry hides secret sections from anyone below owner, so players see the same rendering the public wiki gives them, including differences no callout marks, such as a link only the GM's render resolves. The GM's copy is hidden by Foundry, not absent from the document data. Treat it as obfuscation, and keep real secrets on `role: dm` pages.

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

Set it in `settings.md` to the **highest role your Foundry players may read**. Pages at that role or below import with `OBSERVER` ownership; everything above stays GM-only. Empty, the default, makes none of the vault player-visible.

```yaml
foundry:
  player_role: public
```

For a vault with roles `public`, `patron` and `dm` running that setting:

| Page | Role | Foundry ownership |
|---|---|---|
| [[Aelar]] | public | `default: OBSERVER` (players can read) |
| [[Witchwood Cult]] | patron | GM-only |
| [[Hidden Caves]] | dm | GM-only |

Set it to `patron` and the middle row becomes player-visible too. This vault leaves it empty, so nothing here is player-visible.

### Role-gated callouts inside player-visible pages

[[Aelar]] is `role: public`, so it imports player-visible, but it holds `[!dm]` and `[!patron]` callouts. The two-render body above is what keeps them from players: the GM's render, callouts included, sits in the secret section, and the player render, callouts stripped, sits in the open. The GM sees the full page with Foundry's secret marker and a REVEAL toggle; a player with Observer ownership sees only the player render.

![[screenshot-fvtt-journal-bram-mossfoot.webp|500]]

[[Bram]]'s journal as the GM sees it, with the DM-only material inside the dimmed secret block.

The same holds for an Actor or Item description, which is the page's rendered article and carries the same two renders.

Changing `foundry.player_role` changes ownership and the bodies, which moves the content hash; push, and the next world load offers a rebuild. Documents already imported keep the ownership they arrived with.

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

Setting the flag on a page that has already been built removes its journal page and its document from the pack on the next build, the same as deleting the page. A copy already imported into the world stays.

The alternative is `ignore:` in `settings.md`, which drops the page from the build entirely, so it reaches neither the wiki nor Foundry. Use `ignore:` for files that are not content. Use `foundry.sync: false` for pages that belong on the wiki only.
