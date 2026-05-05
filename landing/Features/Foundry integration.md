---
title: Foundry VTT integration
---

# Foundry VTT integration

The companion [Foundry VTT module](https://github.com/wizzlethorpe/vaults-foundry)
syncs a deployed vault into a Foundry world: every page becomes a
JournalEntry + JournalEntryPage, every wikilink rewrites to a
`@UUID[JournalEntry.…]` enricher, every embedded image is downloaded into
the world's local data dir.

Pages can additionally **clone a compendium document** into the world by
setting `foundry_base: <UUID>` in frontmatter — useful for NPCs and items
that need real Foundry mechanics, not just journal text.

## What gets synced

| Source | Foundry object |
|---|---|
| Each `.md` page | One `JournalEntry` + `JournalEntryPage` (HTML body, foldered to match the vault) |
| `image:` (or auto-discovered cover) | Image cached under `worlds/<id>/vaults-cache/<vault-id>/...` |
| `[[Other Page]]` wikilinks | Rewritten to `@UUID[JournalEntry.<id>]{label}` enrichers |
| Audio / PDFs / other files | Downloaded alongside images |
| `foundry_base: <UUID>` | New `Actor` or `Item` cloned from the template (see below) |

## Actor / Item cloning via `foundry_base`

Set `foundry_base` to any document UUID — usually a compendium document
like an SRD monster or magic item:

```yaml
---
title: Aelar Galanodel
image: aelar-portrait.webp
foundry_base: Compendium.dnd5e.monsters.Actor.O3ABqI55Ir1du1Xa
foundry:
  system:
    attributes:
      hp: { value: 22, max: 30 }
  prototypeToken:
    name: "Aelar (wounded)"
---
```

On sync, the Foundry module:

1. Calls `fromUuid(foundry_base)` to load the template (compendium docs work fine).
2. Clones it into the world under a **deterministic id** derived from
   `(vault.id, page.path)` — re-syncs update the same doc rather than
   creating duplicates.
3. Layers on the page-driven defaults: `name` ← page title, `img` ← cover
   image, description ← `@Embed[…]` of the page's JournalEntryPage.
4. Deep-merges the `foundry:` override block on top, so HP/CR/etc. land
   exactly where the user wants.

The result is a real, mechanically-functional Actor (or Item) whose
description embeds the wiki article. Edit the page → re-sync → the
actor's description updates. Edit the actor's HP in Foundry → the next
sync preserves it (we only overwrite the canonical fields + your
`foundry:` overrides).

In this vault:
- [[Aelar]] clones SRD Scout
- [[Bram]] clones SRD Commoner
- [[Healing Potion]] clones SRD Potion of Healing

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

A page like [[Aelar]] is `role: public`, so it imports as player-visible —
but it contains `[!dm]` and `[!patron]` callouts that the GM authored for
themselves. Without protection, players viewing the journal would see those
callouts even though the wiki strips them at lower tiers.

The module solves this by wrapping each role-gated callout whose tier is
**at-or-above** the configured `dmRole` in a `<section class="secret">`
block during sync. Foundry's renderer hides secret sections from non-GMs
at view time, so:

- **GM** sees the full callout (with the standard "secret" visual marker).
- **Players** with Observer ownership see the journal but **not** the secret
  sections — the structurally-stored HTML hides them at render time, not
  with CSS.

Same gate applies to Actor / Item descriptions that embed the journal page
via `@Embed[…]`: the embed expansion fans out through the page's HTML, so
secret sections inside it stay secret in the doc sheet too.

Force-sync after changing `dmRole` to re-wrap previously-imported pages.

## Public + protected vaults

The module supports both:

- **Public vaults** (single-role): no auth, no `/connect` flow. Direct
  CDN GETs replace the `/_batch` endpoint, which doesn't exist on
  pure-static deploys.
- **Protected vaults** (multi-role): the connect button issues a bearer
  token tied to a chosen role; sync uses that role's variant. Without a
  token, the module syncs the public tier.

Either way, "Sync" is always available. Connect is opt-in for elevation.

## Sync flow

1. Add a vault by URL.
2. Module probes `/_manifest.json` to learn the deploy's roles + the
   vault's display name.
3. Settings dialog opens (label, root folder, dmRole all pre-filled).
4. Click **Sync** — module fetches changed bodies via `/_batch`, downloads
   new images via `/_batch-images`, upserts journals + clones any
   `foundry_base` documents.
5. Subsequent syncs are incremental — the manifest's per-file MD5 hashes
   tell the module exactly what changed, including frontmatter-only edits
   (the hash folds in the body meta).

## Where to get it

[github.com/wizzlethorpe/vaults-foundry](https://github.com/wizzlethorpe/vaults-foundry).
Compatible with Foundry V13+ (verified on V14). dnd5e is the only system
with first-class `foundry_base` support today; other systems will clone
the template but skip the description-embed step.
