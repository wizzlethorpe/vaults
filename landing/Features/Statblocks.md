---
title: Statblocks
---

A built-in code-block handler renders D&D 5e creature statblocks. The schema matches the [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) Obsidian plugin — write the same YAML once, see it render natively in Obsidian (via the plugin) and on your published wiki (via this handler).

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

The damage rolls in the action descriptions are clickable — handler descriptions chain through the inline-handler dispatcher, so `` `dice: 1d6+2` `` inside an action's `desc` becomes a real roll button at render time.

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
    desc: The dragon can use its Frightful Presence. It then makes three attacks — one with its bite and two with its claws.
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

## Supported fields

| Field | Notes |
|---|---|
| `name` | Required for a sensible header. |
| `size`, `type`, `subtype`, `alignment` | Joined into the subheading line. |
| `ac`, `ac_class` | If `ac_class` is present it appears parenthesised after `ac`. |
| `hp`, `hit_dice` | Same — `hit_dice` appears in parens after `hp`. |
| `speed` | Free-form string. |
| `stats` | Six numbers, STR DEX CON INT WIS CHA. Modifiers computed automatically. |
| `saves` | List of `{ ability: bonus }`; ability name is lower-cased and abbreviated. |
| `skillsaves` | List of `{ skill: bonus }`. |
| `damage_vulnerabilities`, `damage_resistances`, `damage_immunities`, `condition_immunities` | Free-form strings. |
| `senses`, `languages` | Free-form strings. |
| `cr` | Quote `"1/4"` etc. so YAML doesn't parse it as a fraction. |
| `traits`, `actions`, `reactions`, `legendary_actions` | Lists of `{ name, desc }`. `desc` supports inline `**bold**`/`*italic*`/`` `code` `` and chains through inline handlers (so `dice:` works inside descriptions). |
| `legendary_description` | Optional intro paragraph for legendary actions. |

Every string field tokenizes inline-handler invocations, so you can pull
data from elsewhere with `fm:` — for example, derive the statblock's CR from
the same `foundry:` block your Foundry actor uses:

````markdown
---
foundry:
  system:
    details:
      cr: 1/4
---

```statblock
name: Goblin
ac: 15
hp: 7
cr: "`fm: foundry.system.details.cr`"
```
````

One source of truth for both the rendered statblock and the synced Foundry
actor sheet. See [[Mossroot]] for a fully worked instance — blank Foundry
NPC actor (no compendium template), all stat fields pulled via `fm:` from
the `foundry:` data block, Foundry sync and wiki render share the YAML.

## What's not (yet) supported

- Spellcasting blocks with nested formatting (the Fantasy Statblocks `spells` field). Workaround: write spell lists into a `traits` entry as plain text.
- Custom layouts (Pathfinder 2e, 13th age, etc.). The current handler always renders the basic 5e layout.
- Image fields. Use a regular Obsidian image embed `![[portrait.png]]` next to the statblock.
- Wikilinks inside `desc` fields. They render as literal `[[...]]` text. Cross-references to other pages should live in surrounding prose.
- JS callbacks. Fantasy Statblocks evaluates arbitrary JS in its layout JSON; we don't.

These are all reasonable adds — they just weren't in the v1 cut.

## Theming

The CSS uses tokens lifted from Fantasy Statblocks so you can override the look from your own `.obsidian/snippets/<name>.css` (which ships as `user.css`):

```css
.statblock {
  --statblock-primary-color: #4a3858;
  --statblock-rule-color: #6b4684;
  --statblock-bg: #f4ecf7;
}
```

The default palette is the canonical D&D scarlet on parchment. If you've themed the rest of your vault to a different accent, the statblock will look out of place until you override these.
