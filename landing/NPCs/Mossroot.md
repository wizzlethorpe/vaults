---
title: Mossroot
image: mossroot-portrait.webp
foundry:
  base: Actor:npc
  data:
    system:
      attributes:
        hp:
          value: 45
          max: 45
        ac:
          flat: 14
        movement:
          walk: 30
          burrow: 10
      details:
        cr: 3
        type:
          value: fey
        alignment: neutral
      abilities:
        str: { value: 16 }
        dex: { value: 13 }
        con: { value: 14 }
        int: { value: 7 }
        wis: { value: 14 }
        cha: { value: 10 }
    prototypeToken:
      name: "Mossroot"
---

A homebrew fey forest-spirit that tends the deep stands of [[Witchwood Cult|Witchwood]] outside the Mossfoot. Locals describe it as "a stump that walks when no one is watching." It is patient, jealous, and very, very good at hearing footsteps.

> [!info] Live demo of three features chained
> This page demonstrates all three of: blank-doc `foundry.base`, the
> ``` `statblock` ``` handler, and ``` `fm:` ``` pulling from frontmatter.
> The block below reads `cr`, AC, and HP straight out of the `foundry.data`
> block, so the wiki render and the synced Foundry actor sheet share one
> source of truth.

## Statblock

```statblock
name: Mossroot
size: Medium
type: fey
alignment: neutral
ac: "`fm: foundry.data.system.attributes.ac.flat`"
hp: "`fm: foundry.data.system.attributes.hp.max`"
hit_dice: 7d8 + 14
speed: "`fm: foundry.data.system.attributes.movement.walk` ft., burrow `fm: foundry.data.system.attributes.movement.burrow` ft."
stats: [16, 13, 14, 7, 14, 10]
saves:
  - constitution: 4
  - wisdom: 4
skillsaves:
  - perception: 4
  - stealth: 5
damage_resistances: bludgeoning, piercing, slashing from nonmagical attacks not made with cold iron
damage_immunities: poison
condition_immunities: charmed, exhaustion, poisoned
senses: darkvision 60 ft., tremorsense 60 ft., passive Perception 14
languages: Sylvan, understands Common
cr: "`fm: foundry.data.system.details.cr`"
traits:
  - name: False Appearance
    desc: While Mossroot remains motionless, it is indistinguishable from a moss-covered stump.
  - name: Forest Camouflage
    desc: Mossroot has advantage on Dexterity (Stealth) checks made to hide in forest terrain.
actions:
  - name: Multiattack
    desc: Mossroot makes two slam attacks.
  - name: Slam
    desc: "*Melee Weapon Attack:* +5 to hit, reach 5 ft., one target. *Hit:* `dice: 2d6+3` bludgeoning damage."
  - name: Tangling Roots (Recharge 5-6)
    desc: "Roots erupt in a 15-foot square centered on a point Mossroot can see within 30 feet. Each creature in that area must succeed on a DC 13 Dexterity saving throw or take `dice: 2d6` bludgeoning damage and be restrained until the end of Mossroot's next turn."
```

## How this page works

The frontmatter declares a blank Foundry NPC actor (no compendium template):

```yaml
foundry:
  base: Actor:npc
  data:
    system:
      attributes:
        hp: { value: 45, max: 45 }
        ac: { flat: 14 }
        movement: { walk: 30, burrow: 10 }
      details:
        cr: 3
        type: { value: fey }
```

The statblock above pulls AC, HP, speeds, and CR from that same `foundry.data` subtree via `` `fm: foundry.data.system.attributes.ac.flat` `` etc. Change the value in one place; both the wiki render and the synced Foundry actor sheet update on the next push. Damage rolls in actions are clickable `dice:` buttons. Everywhere else the inline-handler dispatcher chains naturally because every string field in the statblock YAML is tokenized before render.

See [[Handlers]], [[Statblocks]], and [[Foundry integration]] for the underlying mechanics.
