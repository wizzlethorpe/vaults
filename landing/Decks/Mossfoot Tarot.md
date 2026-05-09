---
title: Mossfoot Tarot
foundry:
  base: Cards
  data:
    name: Mossfoot Tarot
    type: deck
    description: A six-card fortune deck the innkeeper's grandmother used to read futures over a cup of pine tea.
    cards:
      - { name: "The Lantern", type: "base", description: "A small light in a long dark." }
      - { name: "The Bow",     type: "base", description: "Patience that has decided to act." }
      - { name: "The Boar",    type: "base", description: "An old grudge that hasn't finished with you." }
      - { name: "The Bridge",  type: "base", description: "A choice between two banks." }
      - { name: "The Mask",    type: "base", description: "Someone is not who they claim." }
      - { name: "The Hearth",  type: "base", description: "Shelter, briefly, then weather again." }
---

A small fortune deck used at the [[The Mossfoot Inn|Mossfoot]]: six cards, one for each kind
of warning the old innkeeper's grandmother thought was worth giving.

| Card | Meaning |
|---|---|
| `fm: foundry.data.cards.0.name` | `fm: foundry.data.cards.0.description` |
| `fm: foundry.data.cards.1.name` | `fm: foundry.data.cards.1.description` |
| `fm: foundry.data.cards.2.name` | `fm: foundry.data.cards.2.description` |
| `fm: foundry.data.cards.3.name` | `fm: foundry.data.cards.3.description` |
| `fm: foundry.data.cards.4.name` | `fm: foundry.data.cards.4.description` |
| `fm: foundry.data.cards.5.name` | `fm: foundry.data.cards.5.description` |

On Foundry sync this becomes a real `Cards` document of type `deck` with six
`base` cards. No images are wired up, so the cards show Foundry's default
back / blank face; the names and descriptions are what matters for the demo.
