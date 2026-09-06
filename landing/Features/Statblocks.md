---
title: Statblocks
---

A built-in code-block handler renders D&D 5e creature statblocks. The schema matches the [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) Obsidian plugin.

## A worked example

```statblock
name: Goblin
size: Small
type: humanoid
subtype: goblinoid
alignment: neutral evil
ac: 15
ac_class: leather armor, shield
hp: 7
hit_dice: 2d6
speed: 30 ft.
stats: [8, 14, 10, 10, 8, 8]
saves:
  - dexterity: 5
skillsaves:
  - stealth: 6
senses: darkvision 60 ft., passive Perception 9
languages: Common, Goblin
cr: "1/4"
traits:
  - name: Nimble Escape
    desc: The goblin can take the **Disengage** or **Hide** action as a bonus action on each of its turns.
actions:
  - name: Scimitar
    desc: "*Melee Weapon Attack:* +4 to hit, reach 5 ft., one target. *Hit:* `dice: 1d6+2` slashing damage."
  - name: Shortbow
    desc: "*Ranged Weapon Attack:* +4 to hit, range 80/320 ft., one target. *Hit:* `dice: 1d6+2` piercing damage."
```

The damage rolls in the action descriptions are clickable: a `desc` runs through the inline handlers, so `` `dice: 1d6+2` `` becomes a roll button.

## A larger one

```statblock
name: Adult Bronze Dragon
size: Huge
type: dragon
alignment: lawful good
ac: 19
ac_class: natural armor
hp: 212
hit_dice: 17d12 + 102
speed: 40 ft., fly 80 ft., swim 40 ft.
stats: [25, 10, 23, 16, 15, 19]
saves:
  - dexterity: 5
  - constitution: 11
  - wisdom: 7
  - charisma: 9
skillsaves:
  - insight: 7
  - perception: 12
  - stealth: 5
damage_immunities: lightning
senses: blindsight 60 ft., darkvision 120 ft., passive Perception 22
languages: Common, Draconic
cr: "15"
traits:
  - name: Amphibious
    desc: The dragon can breathe air and water.
  - name: Legendary Resistance (3/Day)
    desc: If the dragon fails a saving throw, it can choose to succeed instead.
actions:
  - name: Multiattack
    desc: The dragon can use its Frightful Presence. It then makes three attacks, one with its bite and two with its claws.
  - name: Bite
    desc: "*Melee Weapon Attack:* +12 to hit, reach 10 ft., one target. *Hit:* `dice: 2d10+7` piercing damage."
  - name: Claw
    desc: "*Melee Weapon Attack:* +12 to hit, reach 5 ft., one target. *Hit:* `dice: 2d6+7` slashing damage."
  - name: Lightning Breath (Recharge 5-6)
    desc: "The dragon exhales lightning in a 90-foot line that is 5 feet wide. Each creature in that line must make a DC 19 Dexterity saving throw, taking `dice: 12d10` lightning damage on a failed save, or half as much on a successful one."
legendary_actions:
  - name: Detect
    desc: The dragon makes a Wisdom (Perception) check.
  - name: Tail Attack
    desc: "The dragon makes a tail attack. *Melee Weapon Attack:* +12 to hit, reach 15 ft., one target. *Hit:* `dice: 2d8+7` bludgeoning damage."
  - name: Wing Attack (Costs 2 Actions)
    desc: "The dragon beats its wings. Each creature within 10 feet must succeed on a DC 20 Dexterity saving throw or take `dice: 2d6+7` bludgeoning damage and be knocked prone."
legendary_description: The dragon can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. The dragon regains spent legendary actions at the start of its turn.
```

## Spellcasting

`spells:` takes a list of strings. The first is the intro prose, rendered as a Spellcasting trait. Each following string is one spell-level line, `"<label>: <comma-separated spells>"`.

```statblock
name: Mage
size: Medium
type: humanoid
alignment: any
ac: 12
ac_class: 15 with mage armor
hp: 40
hit_dice: 9d8
speed: 30 ft.
stats: [9, 14, 11, 17, 12, 11]
saves:
  - intelligence: 6
  - wisdom: 4
skillsaves:
  - arcana: 6
  - history: 6
senses: passive Perception 11
languages: any four languages
cr: "6"
spells:
  - "The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). The mage has the following wizard spells prepared:"
  - "Cantrips (at will): fire bolt, light, mage hand, prestidigitation"
  - "1st level (4 slots): detect magic, mage armor, magic missile, shield"
  - "2nd level (3 slots): misty step, suggestion"
  - "3rd level (3 slots): counterspell, fireball, fly"
  - "4th level (3 slots): greater invisibility, ice storm"
  - "5th level (1 slot): cone of cold"
actions:
  - name: Dagger
    desc: "*Melee or Ranged Weapon Attack:* +5 to hit, reach 5 ft. or range 20/60 ft., one target. *Hit:* `dice: 1d4+2` piercing damage."
```

## Supported fields

| Field | Notes |
|---|---|
| `name` | Required. |
| `size`, `type`, `subtype`, `alignment` | Joined into the subheading line. |
| `ac`, `ac_class` | `ac_class`, if present, appears in parentheses after `ac`. |
| `hp`, `hit_dice` | `hit_dice` appears in parentheses after `hp`. |
| `speed` | Free-form string. |
| `stats` | Six numbers: STR, DEX, CON, INT, WIS, CHA. Modifiers are computed. |
| `saves` | A list of single-key `{ ability: bonus }` maps, or one flat map. Ability names are abbreviated. |
| `skillsaves` | A list of single-key `{ skill: bonus }` maps, or one flat map. |
| `damage_vulnerabilities`, `damage_resistances`, `damage_immunities`, `condition_immunities` | Free-form strings. |
| `senses`, `languages` | Free-form strings. |
| `cr` | Quote fractions (`"1/4"`) so YAML does not read them as numbers. |
| `traits`, `actions`, `bonus_actions`, `reactions`, `legendary_actions`, `mythic_actions`, `lair_actions`, `triggered_actions` | Lists of `{ name, desc }`. A `desc` renders bold, italic and code spans and runs through the inline handlers, so `dice:` works inside it. A trait with its own nested `traits` list is flattened into the parent with a `Parent: Child` name. |
| `legendary_description`, `mythic_description` | Intro paragraph for the matching section. |
| `spells` | The spellcasting block above. Spell names are italicised. |
| `source`, `note` | Italic lines at the foot of the block. `source` may be a list. |
| `image` | Portrait in the header: a vault-relative path such as `attachments/goblin.webp`, or an absolute URL. The value is used as written; wikilink and bare-filename forms are not resolved. |

Top-level string fields, the `name` and `desc` of every section entry, and each `spells` entry run through the inline handlers, so a block can read its numbers from elsewhere with `fm:`. For instance, the CR from the same `foundry.patch` block the page's Foundry actor is built from:

````markdown
---
foundry:
  source: Actor:npc
  patch:
    system:
      details:
        cr: 1
---

```statblock
name: Bugbear
ac: 16
hp: 27
cr: "`fm: foundry.patch.system.details.cr`"
```
````

[[Mossroot]] is a fully worked instance: a blank Foundry NPC with every stat field read through `fm:` from its `foundry.patch` block, so the wiki render and the Foundry sheet share one YAML.

## Not supported

- Innate spellcasting (`innate_spellcasting:`) and the PF2e and 13th Age spell variants. The basic 5e `spells:` list is supported (see [Spellcasting](#spellcasting)).
- Layouts other than the basic 5e one.
- Wikilinks inside `desc` fields. They render as literal `[[...]]` text; put cross-references in the surrounding prose.
- JS callbacks. Fantasy Statblocks evaluates arbitrary JS in its layout JSON; this handler does not.

## Theming

The CSS uses the tokens Fantasy Statblocks uses, so a snippet in `.obsidian/snippets/<name>.css` overrides the look. Snippets ship as `user.css`; when `.obsidian/appearance.json` exists, only the snippets it enables are included.

```css
.statblock {
  --statblock-primary-color: #4a3858;
  --statblock-rule-color: #6b4684;
  --statblock-bg: #f4ecf7;
}
```
