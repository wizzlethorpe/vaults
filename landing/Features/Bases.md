---
title: Bases
---

Bases are filtered, sorted table, card or list views over your vault's pages, with the syntax of Obsidian's [Bases plugin](https://help.obsidian.md/bases), rendered at build time. A base is a `.base` file (YAML) embedded with the same `![[Foo]]` syntax as an image, or an inline ` ```base ` block. Both resolve against page frontmatter.

## A small cast

The base below embeds `NPCs.base` from the `Mossfoot/` folder, which queries `Mossfoot/NPCs/`:

![[NPCs]]

The `.base` source:

```yaml
filters:
  and:
    - 'file.folder == "Mossfoot/NPCs"'
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

The base declares two views, `Roster` (cards) and `Stats` (table). More than one view renders as a tab strip. Each card's cover comes from the page's `image:` frontmatter, or from cover discovery when that is absent (see [[Images]]). Table and card views carry a filter box and a row count.

## View types

| Type | Use for |
|---|---|
| `table` | Spreadsheet-style. Stat blocks, item indexes. |
| `cards` | A grid with cover images. NPC rosters, location galleries. |
| `list` | A compact bullet list with optional metadata. Changelogs, link catalogues. |

## Filtering

`filters:` takes a single expression or an `and`, `or` or `not` tree:

```yaml
# Simple
filters: 'role == "patron"'

# Combined
filters:
  and:
    - 'file.folder == "Mossfoot/NPCs"'
    - 'cr >= 2'
    - or:
        - 'location == "Mossfoot Inn"'
        - 'location.contains("Witchwood")'
```

Inside a filter expression an identifier is letters, digits and underscores, so a hyphenated property such as `role-class` parses as subtraction and matches nothing. Hyphenated names work in `order`, `properties` and `sort`, which take the name as a string.

Expressions offer:

- Comparison operators `==`, `!=`, `<`, `<=`, `>`, `>=`, and arithmetic `+`, `-`, `*`, `/`, `%`.
- File functions `file.inFolder("NPCs")`, `file.hasTag("villain")`, `file.hasLink("Aelar")`.
- String methods `.contains()`, `.startsWith()`, `.endsWith()`, `.lower()`, `.upper()`, `.trim()`, `.length`.
- Array methods `.contains()`, `.join()`, `.length`; number methods `.abs()`, `.round()`, `.floor()`, `.ceil()`, `.toFixed()`.
- Functions `if(cond, a, b)`, `min()`, `max()`, `now()`, `today()`, `number()`.

## Sorting and limits

```yaml
views:
  - type: table
    sort:
      - { column: "note.cr", direction: DESC }
      - { column: "file.name", direction: ASC }
    limit: 10
```

A multi-key sort breaks ties from earlier columns with later ones.

## Computed columns

Declare formula columns and reference them as `formula.<name>`:

```yaml
formulas:
  hp_per_cr: 'note.hp / max(1, note.cr)'
views:
  - type: table
    order:
      - file.name
      - formula.hp_per_cr
```

A formula can reference other formulas. A cycle renders an error block in place of the view instead of failing the build.

## A single view by name

Embed one view with a `#` anchor. The anchor must match the view's `name` exactly; a miss renders an error block.

```markdown
![[NPCs#Stats]]      # only the Stats view
```

![[NPCs#Stats]]
