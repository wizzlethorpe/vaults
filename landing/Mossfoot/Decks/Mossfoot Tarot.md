---
title: Mossfoot Tarot
foundry:
  source: Cards
  patch:
    name: Mossfoot Tarot
    type: deck
    description: A six-card fortune deck the innkeeper's grandmother used to read futures over a cup of pine tea.
    cards:
      - _id: mossfootTarot001
        name: "The Lantern"
        type: "base"
        description: "A small light in a long dark."
        face: 0
        faces: [{ name: "The Lantern" }]
      - _id: mossfootTarot002
        name: "The Bow"
        type: "base"
        description: "Patience that has decided to act."
        face: 0
        faces: [{ name: "The Bow" }]
      - _id: mossfootTarot003
        name: "The Boar"
        type: "base"
        description: "An old grudge that hasn't finished with you."
        face: 0
        faces: [{ name: "The Boar" }]
      - _id: mossfootTarot004
        name: "The Bridge"
        type: "base"
        description: "A choice between two banks."
        face: 0
        faces: [{ name: "The Bridge" }]
      - _id: mossfootTarot005
        name: "The Mask"
        type: "base"
        description: "Someone is not who they claim."
        face: 0
        faces: [{ name: "The Mask" }]
      - _id: mossfootTarot006
        name: "The Hearth"
        type: "base"
        description: "Shelter, briefly, then weather again."
        face: 0
        faces: [{ name: "The Hearth" }]
---

A small fortune deck used at the [[The Mossfoot Inn|Mossfoot]]: six cards, one for each kind of warning the old innkeeper's grandmother thought was worth giving.

| Card | Meaning |
|---|---|
| `fm: foundry.patch.cards.0.name` | `fm: foundry.patch.cards.0.description` |
| `fm: foundry.patch.cards.1.name` | `fm: foundry.patch.cards.1.description` |
| `fm: foundry.patch.cards.2.name` | `fm: foundry.patch.cards.2.description` |
| `fm: foundry.patch.cards.3.name` | `fm: foundry.patch.cards.3.description` |
| `fm: foundry.patch.cards.4.name` | `fm: foundry.patch.cards.4.description` |
| `fm: foundry.patch.cards.5.name` | `fm: foundry.patch.cards.5.description` |

In Foundry this is a `Cards` document of type `deck` with six `base` cards. No images are set, so the cards show Foundry's default back and a blank face.