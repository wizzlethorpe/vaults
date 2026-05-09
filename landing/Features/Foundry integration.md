---
title: Foundry VTT integration
---

The companion **Wizzlethorpe Vaults** Foundry VTT module syncs a deployed
vault into a Foundry world: every page becomes a JournalEntry +
JournalEntryPage, every wikilink rewrites to a `@UUID[JournalEntry.…]`
enricher, every embedded image is downloaded into the world's local data
dir.

> [!tip] Install
> The module is on the [Foundry package directory](https://foundryvtt.com/packages/vaults).
> In Foundry, open *Add-on Modules → Install Module*, search for
> **Wizzlethorpe Vaults**, and click Install. Source on
> [GitHub](https://github.com/wizzlethorpe/vaults).

Pages can additionally **instantiate a Foundry document** (Actor, Item,
Scene, etc.) by adding a `foundry:` block to frontmatter.

## What gets synced

| Source | Foundry object |
|---|---|
| Each `.md` page | One `JournalEntry` + `JournalEntryPage` (HTML body, foldered to match the vault) |
| `image:` (or auto-discovered cover) | Image cached under `worlds/<id>/vaults-cache/<vault-id>/...` |
| `[[Other Page]]` wikilinks | Rewritten to `@UUID[JournalEntry.<id>]{label}` enrichers |
| Audio / PDFs / other files | Downloaded alongside images |
| `foundry.base: <UUID>` | New `Actor` or `Item` cloned from the template (see below) |
| `foundry.base: <Type>[:<subtype>]` | Blank `Actor` / `Item` / `Scene` / `JournalEntry` / `RollTable` / `Macro` / `Cards` / `Playlist` (see below) |
| `foundry.embed: false` | Skip auto-embedding the page article into the doc's description field |
| `foundry.data` | Deep-merge overlay applied to the resulting document |
| `foundry.data_json` | Vault-relative path to a JSON file deep-merged into the doc *before* `foundry.data` (use for exported sheets / community-shared dumps) |

## Actor / Item cloning via `foundry.base`

Set `foundry.base` to any document UUID, usually a compendium document
like an SRD monster or magic item:

```yaml
---
title: Aelar Galanodel
image: aelar-portrait.webp
foundry:
  base: Compendium.dnd5e.monsters.Actor.O3ABqI55Ir1du1Xa
  data:
    system:
      attributes:
        hp: { value: 22, max: 30 }
    prototypeToken:
      name: "Aelar (wounded)"
---
```

On sync, the Foundry module:

1. Calls `fromUuid(foundry.base)` to load the template.
2. Clones it into the world under a **deterministic id** derived from
   `(vault.id, page.path)` and re-syncs update the same doc rather than
   creating duplicates.
3. Layers on the page-driven defaults: `name` ← page title, `img` ← cover
   image, description ← `@Embed[…]` of the page's JournalEntryPage.
4. Deep-merges `foundry.data` on top, so HP/CR/etc. land exactly where
   they are supposed to.

The result is an Actor (or Item) whose description embeds the wiki article. Edit the actor's HP in Foundry, the next sync preserves it (we only overwrite the canonical fields + your `foundry.data` overrides).

For pages that *shouldn't* leak their article into the actor sheet, DM-private notes, or stats-only pages where the embed adds nothing, set `foundry.embed: false`. The clone / blank doc still gets created with the right name, image, and `foundry.data` overlay; only the description field is left at whatever the template (or blank) had.

### Blank documents

When no template exists in any compendium (pure homebrew, bespoke maps,
custom roll tables), use the type-form of `foundry.base`:

```yaml
---
title: Joywraith
foundry:
  base: Actor:npc
  data:
    system:
      attributes:
        hp: { value: 67, max: 67 }
        ac: { value: 13 }
      details:
        cr: 4
---
```

`foundry.base: Scene` makes a blank scene, `foundry.base: RollTable` a
blank table, `foundry.base: Item:weapon` a blank weapon, and so on. The
same deterministic-id and `foundry.data` overlay rules apply: the doc
lives at a known id, sync re-applies your overrides, and a deleted page
deletes the doc. Supported types: Actor, Item, Scene, JournalEntry,
RollTable, Macro, Cards, Playlist. Subtypes are system-specific (dnd5e
Actor: npc, character, vehicle, group; dnd5e Item: weapon, equipment,
consumable, …). The bare-type form (`foundry.base: Actor`) skips subtype
and lets the active system pick its default, which keeps the syntax
portable across systems.

[[Mossroot]] is a worked example: blank `Actor:npc`, full `foundry.data`
block, statblock pulling AC/HP/CR/speed via `fm:` from that same block, so
one frontmatter source drives both the wiki render and the synced Foundry
actor sheet.

In this vault:
- [[Aelar]] clones SRD Scout
- [[Bram]] clones SRD Commoner
- [[Healing Potion]] clones SRD Potion of Healing


![[screenshot-fvtt-actor-aelar-galanodel.webp|500]]

[[Aelar]] in dnd5e: note the "A" portrait synced from the vault, the page's title used as the document name, and the HP override (22/30) reflecting the `foundry:` block.

---

![[screenshot-fvtt-item-potion-of-healing.webp|500]]

[[Healing Potion]] as a cloned dnd5e item: title from the page's
frontmatter, the article body embedded as the description, the
`foundry.system.description.chat` override visible in the chat
description block.

---

### Starting from an exported JSON sheet

When you've got a hand-tuned Actor / Item / Scene from elsewhere (a
community share, an export from a previous campaign, a custom-built
sheet), point `foundry.data_json` at a JSON file in the vault and
the module deep-merges it onto the new document *before* `foundry.data`
applies. Lets you reuse the bulk of an existing sheet and still patch
specific fields per page:

```yaml
---
title: Strahd von Zarovich
foundry:
  base: Actor:npc
  data_json: ./sheets/strahd-export.json   # vault-relative path
  data:
    system:
      attributes:
        hp: { value: 144, max: 200 }       # patches strahd-export.json
---
```

JSON files ship to the deploy as passthroughs (gated per role like any
other file), and the build hashes the parsed content into the page's
manifest entry — change the JSON, re-sync triggers an update.

[[Aelar]] is the live demo: he points at `sheets/aelar-export.json` for
biography, languages, skills, and pocket change, then layers the wound
penalty (HP 22/30), a CR bump, and the "(wounded)" token name from his
page's `foundry.data` block on top.

---

## Per-vault dmRole setting

Multi-role vaults (this one, for example) can pick a "DM cutoff" in the
Foundry module's per-vault settings. Pages whose role is **below the
cutoff** import as `OBSERVER` ownership (player-visible journals). Pages
**at or above** stay GM-only. A vault running this rule with `dmRole: dm`:

| Page | Role | Foundry ownership |
|---|---|---|
| [[Aelar]] | public | `default: OBSERVER` (players can read) |
| [[Witchwood Cult]] | patron | `default: OBSERVER` |
| [[Hidden Caves]] | dm | GM-only |

Set this in the per-vault settings dialog after the first sync.

### Hiding role-gated callouts inside player-visible pages

A page like [[Aelar]] is `role: public`, so it imports as player-visible,
but it contains `[!dm]` and `[!patron]` callouts that the GM authored for
themselves. Without protection, players viewing the journal would see those
callouts even though the wiki strips them at lower tiers.

The module solves this by wrapping each role-gated callout whose tier is
**at-or-above** the configured `dmRole` in a `<section class="secret">`
block during sync. Foundry's renderer hides secret sections from non-GMs
at view time, so:

- **GM** sees the full callout (with the standard "secret" visual marker
  and a "REVEAL" toggle to flip it to player-visible if they want).
- **Players** with Observer ownership see the journal but **not** the secret
  sections. The structurally-stored HTML hides them at render time, not
  with CSS.

[[Bram]]'s journal as the GM sees it. The `[!dm]` callout from the
markdown is wrapped in a Foundry secret block (the dimmed "DM ONLY"
section with the REVEAL divider), invisible to OBSERVER-tier players:

![[screenshot-fvtt-journal-bram-mossfoot.webp|500]]

Same gate applies to Actor / Item descriptions that embed the journal page
via `@Embed[…]`: the embed expansion fans out through the page's HTML, so
secret sections inside it stay secret in the doc sheet too.

Force-sync after changing `dmRole` to re-wrap previously-imported pages.

> [!warning] WARNING
> There is a known Foundry bug where secrets do not work on documents owned by a non-GM user. This isn't typically an issue with imported Journal Entries since they default to GM ownership (players get read access via the OBSERVER role), but it can cause problems if you change ownership or (more likey), a page is Embedded into an Actor/Item sheet that is owned by a non-GM. Be careful about this!
