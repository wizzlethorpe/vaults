---
title: Witchwood Wandering Encounters
foundry:
  base: RollTable
  # Defining the table once in frontmatter gives Foundry a real RollTable
  # the GM can roll on, and the page body re-uses the same data via `fm:`
  # so the wiki rendering can't drift from the Foundry doc.
  data:
    name: Witchwood Wandering Encounters
    formula: 1d6
    description: What you meet at the Witchwood's edge after dark.
    results:
      - { type: "text", range: [1, 1], weight: 1, name: "A weary ranger sharpening arrows by lamplight (Aelar, on patrol)." }
      - { type: "text", range: [2, 2], weight: 1, name: "Three goblin scouts arguing over a dropped boot. Disadvantage to surprise them." }
      - { type: "text", range: [3, 3], weight: 1, name: "A lone owlbear, half-asleep, gnawing on a deer haunch." }
      - { type: "text", range: [4, 4], weight: 1, name: "Two cultists in bone-white masks, scratching sigils into a birch trunk." }
      - { type: "text", range: [5, 5], weight: 1, name: "A merchant's overturned cart. The horses are gone; the strongbox isn't." }
      - { type: "text", range: [6, 6], weight: 1, name: "Nothing. Only the wind, and the feeling of being watched." }
---

A `1d6` encounter table for the dark hours along the Witchwood border.
The table data lives once in this page's `foundry:` block, so Foundry
gets a real, rollable `RollTable` and the prose below stays in sync via
the [[Features/Handlers#Built-in fm|fm: handler]] dot-pathing into
`foundry.data.results[N].name`.

Roll `dice: 1d6`. `fm: foundry.data.description`

| Roll | Encounter |
|---|---|
| 1 | `fm: foundry.data.results.0.name` |
| 2 | `fm: foundry.data.results.1.name` |
| 3 | `fm: foundry.data.results.2.name` |
| 4 | `fm: foundry.data.results.3.name` |
| 5 | `fm: foundry.data.results.4.name` |
| 6 | `fm: foundry.data.results.5.name` |

## How this page works

The `foundry.base: RollTable` line tells the Foundry module to spawn a
blank `RollTable` document keyed to this page; `foundry.data` is
deep-merged onto it, so the GM ends up with a real rollable table whose
formula is `1d6` and whose results are the six entries above.

The body table reuses the same data: each row is just an **fm:**
lookup into `foundry.data.results.N.name`. The **fm:** handler walks
dot-paths and treats numeric segments as array indices, so editing the
frontmatter updates both the Foundry RollTable on next sync and the
prose rendering on next build, with no hand-syncing.

If you'd rather author your tables in the body and have a small custom
handler render them, see [[Features/Handlers#Writing a custom handler]].
