---
title: Bases
---

# Bases

Bases are filtered, sorted, table-or-card views over your vault's pages —
the same idea as Obsidian's [Bases plugin](https://help.obsidian.md/bases),
but rendered statically at build time. They're declared as `.base` files
(YAML), embedded into pages via the same `![[Foo]]` syntax as image embeds,
and resolved against page frontmatter.

## The example on the homepage

The [[index|homepage]] embeds `NPCs.base` (in the vault root) which queries
the `NPCs/` folder. Here's the same Base, re-embedded:

![[NPCs]]

The `.base` source:

```yaml
filters:
  and:
    - 'file.folder == "NPCs"'
    - 'file.name != "index"'
properties:
  note.role-class: { displayName: Class }
  note.location: { displayName: Location }
views:
  - type: cards
    name: Roster
    image: image
    imageFit: cover
    imageAspectRatio: 1
    order:
      - file.name
      - note.role-class
      - note.location
  - type: table
    name: Stats
    order:
      - file.name
      - note.role-class
      - note.cr
      - note.location
```

Two views were declared (`Roster` cards + `Stats` table); both render in
order. Each card's cover image comes from the page's `image:` frontmatter
(falling back to body auto-discovery — see [[Images]]).

## View types

| Type | Use for |
|---|---|
| `table` | Spreadsheet-style. Good for stat blocks, item indexes. |
| `cards` | Visual grid with cover images. Good for NPC rosters, location galleries. |
| `list` | Compact bullet list with optional metadata. Good for changelogs, link catalogues. |

Multiple views in one Base render as a sequence; the user doesn't tab
between them.

## Filtering

`filters:` accepts a single expression or an `and`/`or` tree:

```yaml
# Simple
filters: 'role == "patron"'

# Combined
filters:
  and:
    - 'file.folder == "NPCs"'
    - 'cr >= 2'
    - or:
        - 'role-class == "Ranger"'
        - 'role-class == "Rogue"'
```

Available functions: `file.inFolder("NPCs")`, `file.hasTag("villain")`,
plus comparison operators (`==`, `!=`, `<`, `<=`, `>`, `>=`, `contains`,
`startsWith`, `endsWith`).

## Sorting + limits

```yaml
views:
  - type: table
    sort:
      - { column: "note.cr", direction: DESC }
      - { column: "file.name", direction: ASC }
    limit: 10
```

Multi-key sort breaks ties from earlier columns with later ones.

## Computed columns

You can declare formula columns and reference them as `formula.<name>`:

```yaml
formulas:
  hp_per_cr: 'note.hp / max(1, note.cr)'
views:
  - type: table
    order:
      - file.name
      - formula.hp_per_cr
```

Formulas can reference other formulas (cycle detection inline-renders an
error block instead of crashing the build).

## Standalone view names

Embed a specific view by name with a `#` anchor:

```markdown
![[NPCs#Stats]]      # render only the Stats view
```

Useful when the same Base wants to appear in different shapes on different
pages.

## When to use a Base vs. a folder index

The CLI auto-generates a folder `index.md` for any folder without one
(see `NPCs/index` for an example — it's a generated cards-view of the
folder's pages). Custom Bases are for cross-cutting filters that don't
match folder boundaries (e.g. "every NPC in any folder tagged as a
villain" or "all sessions where the party visited the inn").
