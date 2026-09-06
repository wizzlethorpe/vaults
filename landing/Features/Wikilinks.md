---
title: Wikilinks
---

Vaults resolves the same `[[Page Name]]` syntax as Obsidian, at build time, so a broken link is a build warning, whether you run `vaults build`, `vaults preview` or `vaults push`.

## Basic forms

The common form is the page's basename. Folders need not appear:

| Markdown | Renders as |
|---|---|
| `[[Aelar]]` | [[Aelar]] |
| `[[Bram]]` | [[Bram]] |
| `[[The Mossfoot Inn]]` | [[The Mossfoot Inn]] |
| `[[Healing Potion]]` | [[Healing Potion]] |

## Aliases

A pipe sets the displayed text:

| Markdown | Renders as |
|---|---|
| `[[Aelar\|the elven ranger]]` | [[Aelar|the elven ranger]] |
| `[[The Mossfoot Inn\|the inn]]` | [[The Mossfoot Inn|the inn]] |

## Folder paths

Folder-prefixed paths work too:

| Markdown | Renders as |
|---|---|
| `[[Mossfoot/NPCs/Aelar]]` | [[Mossfoot/NPCs/Aelar]] |
| `[[Mossfoot/Lore/The Mossfoot Inn]]` | [[Mossfoot/Lore/The Mossfoot Inn]] |

## Resolution

A link is tried four ways, in order: as a full path, as a path relative to the vault root, as `<name>/index` (so `[[NPCs]]` opens a folder's index page), and by its last segment. Frontmatter aliases take part in the same lookup. A bare name therefore resolves whenever its basename is unique, and a folder path disambiguates when it is not.

## Image embeds

The same syntax with a leading `!` embeds an image:

```markdown
![[aelar-portrait.webp]]
![[aelar-portrait.webp|240]]   # explicit width
```

![[aelar-portrait.webp|180]]

## Page transclusion

An embed whose target is a page inlines that page's rendered body. Put it on a line of its own:

```markdown
![[Bram]]                        # the whole page
![[Statblocks#Spellcasting]]     # one section
![[Statblocks#Spellcasting#Tips]] # a nested heading
![[Bram#^tavern]]                # one block, by block id
```

Transcluded pages are rendered in full, so their wikilinks, handlers and embeds work. Nesting stops after two levels inside the outer transclusion. Two pages that embed each other are caught by name, and the inner embed renders as a warning callout.

Role gating applies to the transcluded page: an embed of a page above the reader's tier renders as a broken embed, like a link to it.

## Cross-tier behaviour

A wikilink to a page above your tier renders as an unresolved link, faded and italic, pointing nowhere. The lower-tier build has no record of the page, so even the guessed URL returns 404. Read this page at each tier to compare:

> [!patron] Patron-only
> Linked here: [[Witchwood Cult]]. It works for you and is unresolved for public visitors.

> [!dm] DM-only
> Linked here: [[Hidden Caves]]. It works for the DM and is unresolved for everyone else.
