---
title: Witchwood Wandering Encounters
foundry:
  source: RollTable
  # Defining the table once in frontmatter gives Foundry a real RollTable
  # the GM can roll on, and the page body re-uses the same data via `fm:`
  # so the wiki rendering can't drift from the Foundry doc.
  patch:
    name: Witchwood Wandering Encounters
    formula: 1d6
    description: What you meet at the Witchwood's edge after dark.
    results:
      - { _id: witchwoodEnc0001, type: "text", range: [1, 1], weight: 1, description: "A weary ranger sharpening arrows by lamplight (Aelar, on patrol)." }
      - { _id: witchwoodEnc0002, type: "text", range: [2, 2], weight: 1, description: "Three goblin scouts arguing over a dropped boot. Disadvantage to surprise them." }
      - { _id: witchwoodEnc0003, type: "text", range: [3, 3], weight: 1, description: "A lone owlbear, half-asleep, gnawing on a deer haunch." }
      - { _id: witchwoodEnc0004, type: "text", range: [4, 4], weight: 1, description: "Two cultists in bone-white masks, scratching sigils into a birch trunk." }
      - { _id: witchwoodEnc0005, type: "text", range: [5, 5], weight: 1, description: "A merchant's overturned cart. The horses are gone; the strongbox isn't." }
      - { _id: witchwoodEnc0006, type: "text", range: [6, 6], weight: 1, description: "Nothing. Only the wind, and the feeling of being watched." }
---

A `1d6` encounter table for the dark hours along the Witchwood border. The table lives once, in this page's `foundry:` block: Foundry gets a rollable `RollTable`, and the rows below read the same data through the [[Features/Handlers#built-in-fm|fm: handler]] at `foundry.patch.results.N.description`.

Roll `dice: 1d6`. `fm: foundry.patch.description`

| Roll | Encounter |
|---|---|
| 1 | `fm: foundry.patch.results.0.description` |
| 2 | `fm: foundry.patch.results.1.description` |
| 3 | `fm: foundry.patch.results.2.description` |
| 4 | `fm: foundry.patch.results.3.description` |
| 5 | `fm: foundry.patch.results.4.description` |
| 6 | `fm: foundry.patch.results.5.description` |

## How this page works

`foundry.source: RollTable` builds a blank `RollTable` for this page, and `foundry.patch` is deep-merged onto it. Each row of the body table is an **fm:** lookup into `foundry.patch.results.N.description`; numeric path segments index into arrays. Editing the frontmatter updates the Foundry table on the next build and the page on the next push.

To author tables in the body and render them with a small custom handler, see [[Features/Handlers#writing-a-custom-handler]].
