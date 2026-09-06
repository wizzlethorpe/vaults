---
title: Mossroot
image: mossroot-portrait.webp
role-class: Fey
location: Witchwood
cr: 3
foundry:
  source: Actor:npc
  patch:
    system:
      attributes:
        hp:
          value: 45
          max: 45
        ac:
          flat: 14
          calc: natural
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

> [!info] Three features chained
> This page combines a blank-document `foundry.source`, the `statblock` handler, and `fm:` reading from frontmatter. The block below reads CR, AC and HP out of the `foundry.patch` block, so the wiki render and the Foundry actor sheet share one source.

## Statblock

```statblock
name: Mossroot
size: Medium
type: fey
alignment: neutral
ac: "`fm: foundry.patch.system.attributes.ac.flat`"
hp: "`fm: foundry.patch.system.attributes.hp.max`"
hit_dice: 7d8 + 14
speed: "`fm: foundry.patch.system.attributes.movement.walk` ft., burrow `fm: foundry.patch.system.attributes.movement.burrow` ft."
stats: [16, 13, 14, 7, 14, 10]
saves:
  - constitution: 4
  - wisdom: 4
skillsaves:
  - perception: 4
  - stealth: 3
damage_resistances: bludgeoning, piercing, slashing from nonmagical attacks not made with cold iron
damage_immunities: poison
condition_immunities: charmed, exhaustion, poisoned
senses: darkvision 60 ft., tremorsense 60 ft., passive Perception 14
languages: Sylvan, understands Common
cr: "`fm: foundry.patch.system.details.cr`"
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

The frontmatter declares a blank Foundry NPC with no compendium template. An excerpt:

```yaml
foundry:
  source: Actor:npc
  patch:
    system:
      attributes:
        hp: { value: 45, max: 45 }
        ac: { flat: 14, calc: natural }
        movement: { walk: 30, burrow: 10 }
      details:
        cr: 3
        type: { value: fey }
```

The statblock reads AC, HP, speeds and CR from that `foundry.patch` subtree through `` `fm: foundry.patch.system.attributes.ac.flat` `` and the like. Change a value once and the wiki render and the Foundry sheet both update on the next push. The damage rolls in actions are `dice:` buttons: top-level string fields and each action's name and description run through the inline handlers before the block renders.

See [[Handlers]], [[Statblocks]], and [[Foundry integration]] for the underlying mechanics.
