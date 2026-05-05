---
title: Wikilinks
---

# Wikilinks

Vaults supports the same `[[Page Name]]` wikilink syntax as Obsidian, with
some Obsidian-flavored extensions. Resolution happens at build time, so
broken links surface as warnings during `vaults push`.

## Basic forms

The most common form is just the page's basename. Folders don't need to
appear in the link:

| Markdown | Renders as |
|---|---|
| `[[Aelar]]` | [[Aelar]] |
| `[[Bram]]` | [[Bram]] |
| `[[The Mossfoot Inn]]` | [[The Mossfoot Inn]] |
| `[[Healing Potion]]` | [[Healing Potion]] |

## Aliases

Use a pipe to display custom text:

| Markdown | Renders as |
|---|---|
| `[[Aelar\|the elven ranger]]` | [[Aelar|the elven ranger]] |
| `[[The Mossfoot Inn\|the inn]]` | [[The Mossfoot Inn|the inn]] |

## Folder paths

Folder-prefixed paths still work for disambiguation:

| Markdown | Renders as |
|---|---|
| `[[NPCs/Aelar]]` | [[NPCs/Aelar]] |
| `[[Lore/The Mossfoot Inn]]` | [[Lore/The Mossfoot Inn]] |

In practice you'll rarely need them — bare names resolve as long as the
basename is unique across the vault.

## Image embeds

The same syntax with a leading `!` embeds an image:

```markdown
![[aelar-portrait.webp]]
![[aelar-portrait.webp|240]]   # explicit width
```

![[aelar-portrait.webp|180]]

## Cross-tier behavior

Wikilinks to pages above your role tier render as **broken** rather than
working anchors. This is structural: the lower-tier build has no record
of the higher-tier page existing, so even guessing the URL would 404. Try
this page at each tier to compare:

> [!patron] Patron-only
> Linked here: [[Witchwood Cult]]. works for you, broken for public visitors.

> [!dm] DM-only
> Linked here: [[Hidden Caves]]. works for the DM, broken for everyone else.
