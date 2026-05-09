---
title: Handlers
---

Handlers are small build-time transforms that turn a special markdown form into rendered HTML. Two trigger shapes:

- **Inline:** `` `prefix: content` ``: a plain inline-code span where the content starts with a registered prefix and a colon.
- **Code block:** ` ```lang `: a fenced code block whose language tag matches a registered handler.

Vaults currently includes three built-in handlers and lets you add your own under `.vaults/handlers/`.

## Built-in: ``` `dice:` ```

Click the rolled die for a fresh result.

| Markdown | Renders as |
|---|---|
| `` `dice: 1d20+5` `` | `dice: 1d20+5` |
| `` `dice: 8d6` `` | `dice: 8d6` |
| `` `dice: 1d100` `` | `dice: 1d100` |

Unrecognised formulas degrade to a struck-through code span instead of crashing the build:

| Markdown | Renders as |
|---|---|
| `` `dice: not-a-formula` `` | `dice: not-a-formula` |

Supported syntax: `XdY`, `XdY+Z`, `XdY-Z`. More elaborate dice notation (advantage, exploding, keep-highest) is not in scope are not currently supported.

## Built-in: `fm:`

Inserts a value from this page's frontmatter. The frontmatter on this very page is:

```yaml
title: Handlers
```

So `` `fm: title` `` renders as: `fm: title`. Frontmatter values flow through the rest of the markdown pipeline, so you can put inline markup in your frontmatter and it will render. This is handy when the same value appears in a heading and in prose, and you don't want to hand-sync the formatting.

Missing keys render a visible warning marker so typos surface instead of silently emitting "undefined":

| Markdown | Renders as |
|---|---|
| `` `fm: nope` `` | `fm: nope` |

Date frontmatter values (YAML auto-parses ISO 8601 to JS `Date`) format as YYYY-MM-DD. Arrays join with `, `. Objects emit the warning marker, but you can dot-path into them: `` `fm: stats.hp` `` walks nested keys, with any missing segment along the path triggering the warning.

## Built-in: `statblock`

A code-block handler keyed on `` ```statblock ``, schema-compatible with the [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) Obsidian plugin. See the dedicated [[Statblocks]] page for a full demo.

```statblock
name: Pseudodragon
size: Tiny
type: dragon
alignment: neutral good
ac: 13
hp: 7
hit_dice: 2d4 + 2
speed: 15 ft., fly 60 ft.
stats: [6, 15, 13, 10, 12, 10]
skillsaves:
  - perception: 5
  - stealth: 4
damage_immunities: ""
condition_immunities: ""
senses: blindsight 10 ft., darkvision 60 ft., passive Perception 15
languages: understands Common and Draconic but can't speak
cr: "1/4"
traits:
  - name: Keen Senses
    desc: The pseudodragon has advantage on Wisdom (Perception) checks that rely on sight, hearing, or smell.
actions:
  - name: Bite
    desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: `dice: 1d4+2` piercing damage."
```

Note the `dice:` button inside the action description. Handler descriptions support inline handler chaining, so dice expressions in stat damage rolls click through like everywhere else.

## Writing a custom handler

Drop a file in `.vaults/handlers/` and export a `handler` (or `handlers: []`):

```javascript
// .vaults/handlers/shout.mjs
export const handler = {
  inline: "shout",
  render(content, ctx) {
    return { html: "<strong>" + content.toUpperCase() + "</strong>" };
  },
};
```

Now `` `shout: hello` `` renders as a bold uppercase **HELLO** anywhere in the vault.

Handler API surface:

- **Inline:** `{ inline: "prefix", render(content, ctx) }`
- **Code block:** `{ codeBlock: "lang", render(content, ctx) }`
- Return `{ html: "..." }` to insert raw markup, or `{ markdown: "..." }` to re-process through the rest of the pipeline (wikilinks resolve, embeds inline, dice buttons in your output get picked up).
- `ctx.frontmatter` is the rendering page's parsed frontmatter; `ctx.pagePath` is its vault-relative path; `ctx.escape(s)` is an HTML-escape helper; `ctx.applyInlineHandlers(s)` lets your handler invoke other inline handlers (this is how `statblock`'s `desc` fields support `dice:`).

### Browser-side assets

Handlers can ship JS and CSS to the deploy:

```javascript
export const handler = {
  codeBlock: "widget",
  assets: {
    scripts: ["./widget.runtime.js"],
    styles: ["./widget.css"],
  },
  render() { return { html: '<div class="widget"></div>' }; },
};
```

### Foundry import opt-in

By default, handler-shipped CSS/JS only reaches the wiki — the Foundry VTT module ignores it because running arbitrary scripts from a third-party URL inside a Foundry world is the kind of thing that warrants explicit consent. To make a handler's assets *eligible* for import into Foundry, add a `targets.foundry` block:

```javascript
export const handler = {
  inline: "clicker",
  assets: {
    scripts: ["./clicker.runtime.js"],
    styles: ["./clicker.css"],
    targets: {
      foundry: { scripts: true, styles: true },  // both default false
    },
  },
  render: ...,
};
```

The `targets` block is generic so future consumers (MCP server, other VTTs) can plug in alongside Foundry without each carving a new top-level key on `assets`.

Two layers of consent gate this:

1. **Handler-side opt-in** (above) — only handlers that set `targets.foundry.scripts` / `targets.foundry.styles` get bundled into the deploy's `_handlers.foundry.{js,css}`. Everything else stays wiki-only.
2. **GM-side opt-in** in the Foundry module's per-vault settings dialog ("Import handler stylesheets" / "Import handler scripts" checkboxes, both default off, with a confirmation warning when flipping on).

Live demo: this vault ships a `clicker:` inline handler with both opted in. `clicker: try me` renders as `clicker: try me` (click it!). On the wiki it works because the handler's CSS + JS shipped at `_handlers.{css,js}`. In Foundry it works only if the GM checked both import boxes for this vault — otherwise the journal page shows an unstyled, inert button (since the wiki HTML containing `<button class="vaults-clicker">` survives the sync, but the styling/behaviour does not).

