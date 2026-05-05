---
title: Foundry VTT integration
---

# Foundry VTT integration

The companion **Wizzlethorpe Vaults** Foundry VTT module syncs a deployed
vault into a Foundry world: every page becomes a JournalEntry +
JournalEntryPage, every wikilink rewrites to a `@UUID[JournalEntry.…]`
enricher, every embedded image is downloaded into the world's local data
dir.

> [!tip] Install
> The module is on the [Foundry package directory](https://foundryvtt.com/packages/vaults).
> In Foundry, open *Add-on Modules → Install Module*, search for
> **Wizzlethorpe Vaults**, and click Install. Source on
> [GitHub](https://github.com/wizzlethorpe/vaults-foundry).

Pages can additionally **clone a compendium document** into the world by
setting `foundry_base: <UUID>` in frontmatter. This is useful for NPCs and
items that need real Foundry mechanics, not just journal text.

## What gets synced

| Source | Foundry object |
|---|---|
| Each `.md` page | One `JournalEntry` + `JournalEntryPage` (HTML body, foldered to match the vault) |
| `image:` (or auto-discovered cover) | Image cached under `worlds/<id>/vaults-cache/<vault-id>/...` |
| `[[Other Page]]` wikilinks | Rewritten to `@UUID[JournalEntry.<id>]{label}` enrichers |
| Audio / PDFs / other files | Downloaded alongside images |
| `foundry_base: <UUID>` | New `Actor` or `Item` cloned from the template (see below) |

## Actor / Item cloning via `foundry_base`

Set `foundry_base` to any document UUID, usually a compendium document
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

1. Calls `fromUuid(foundry_base)` to load the template.
2. Clones it into the world under a **deterministic id** derived from
   `(vault.id, page.path)` and re-syncs update the same doc rather than
   creating duplicates.
3. Layers on the page-driven defaults: `name` ← page title, `img` ← cover
   image, description ← `@Embed[…]` of the page's JournalEntryPage.
4. Deep-merges the `foundry:` override block on top, so HP/CR/etc. land
   exactly where they are supposed to.

The result is an Actor (or Item) whose description embeds the wiki article. Edit the actor's HP in Foundry → the next sync preserves it (we only overwrite the canonical fields + your `foundry:` overrides).

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
