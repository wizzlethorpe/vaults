---
title: Handlers
---

Handlers are build-time transforms that turn a special markdown form into HTML. Two trigger shapes:

- **Inline:** `` `prefix: content` ``, an inline code span whose content starts with a registered prefix and a colon.
- **Code block:** ` ```lang `, a fenced code block whose language tag names a registered handler.

Nine handlers are built in, and you can add your own under `.vaults/handlers/`:

| Handler | Trigger | Demo |
|---|---|---|
| `dice` | inline | below |
| `fm` | inline | below |
| `fm` | code block | below |
| `statblock` | code block | [[Statblocks]] |
| `battlemap` | code block | [[Battlemaps]] |
| `gallery` | code block | below |
| `download` | code block | below |
| `foundry-install` | code block | [[Foundry integration]] |
| `fvtt-link` | inline | [[Foundry integration]] |

## Built-in: `` `dice:` ``

Click the rolled die for a fresh result.

| Markdown | Renders as |
|---|---|
| `` `dice: 1d20+5` `` | `dice: 1d20+5` |
| `` `dice: 8d6` `` | `dice: 8d6` |
| `` `dice: 1d100` `` | `dice: 1d100` |

An unrecognised formula renders as a struck-through code span:

| Markdown | Renders as |
|---|---|
| `` `dice: not-a-formula` `` | `dice: not-a-formula` |

Supported syntax: `XdY`, `XdY+Z`, `XdY-Z`. Advantage, exploding and keep-highest notation are not supported.

## Built-in: `` `fm:` ``

Inserts a value from the page's frontmatter. This page's frontmatter is:

```yaml
title: Handlers
```

So `` `fm: title` `` renders as: `fm: title`. Values pass through a small inline formatter: `**bold**`, `*italic*` and `` `code` `` render; wikilinks do not.

A missing key renders a visible warning marker, so a typo surfaces instead of an empty string:

| Markdown | Renders as |
|---|---|
| `` `fm: nope` `` | `fm: nope` |

Date values (YAML parses ISO 8601 dates) format as YYYY-MM-DD. Arrays join with `, `. Objects emit the warning marker, but a dot path walks into them: `` `fm: stats.hp` `` reads a nested key, and a missing segment anywhere along the path triggers the warning.

Numeric segments index into arrays: `` `fm: foundry.patch.results.0.description` `` reads the first row's `description`. [[Witchwood encounters]] uses this to render a `RollTable` defined in `foundry.patch` as a markdown table in the page body, with nothing duplicated between the Foundry document and the wiki.

For a value that belongs in `<pre><code>` (a script body, a long string) there is a fenced form keyed on `fm`. The body is the dot path; text after the language tag is the language hint for the rendered code element:

````
```fm javascript
foundry.patch.command
```
````

Renders as `<pre><code class="language-javascript">…</code></pre>`. The macro pages ([[Toggle feast]], [[Toggle lights]], [[Toggle ambient noise]]) display their `command` source this way.

## Built-in: `statblock`

A code-block handler keyed on `` ```statblock ``, schema-compatible with the [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) Obsidian plugin. See [[Statblocks]] for the full demo.

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

The `dice:` button inside the action description works because handler descriptions run through the inline handlers.

## Built-in: `gallery`

A responsive grid of thumbnails. One image per line, named the way a `![[file]]` embed names it, with an optional caption after a pipe. Lines starting with `#` are comments.

````
```gallery
screenshot-fvtt-actor-aelar-galanodel.webp | Aelar as a dnd5e Actor
screenshot-fvtt-item-potion-of-healing.webp | The potion as an Item
screenshot-fvtt-journal-bram-mossfoot.webp | Bram's journal entry
```
````

```gallery
screenshot-fvtt-actor-aelar-galanodel.webp | Aelar as a dnd5e Actor
screenshot-fvtt-item-potion-of-healing.webp | The potion as an Item
screenshot-fvtt-journal-bram-mossfoot.webp | Bram's journal entry
```

Images resolve through the same index as `![[ ]]` embeds, so anything a gallery names is staged into the deploy and gated per role like any other image.

## Built-in: `download`

A download link for a file in the vault:

````
```download
file: Mossfoot/Audio/mossfoot-tavern.ogg
label: Mossfoot tavern ambience
note: 1.4 MB, OGG
```
````

```download
file: Mossfoot/Audio/mossfoot-tavern.ogg
label: Mossfoot tavern ambience
note: 1.4 MB, OGG
```

The file ships only to the variants of the pages that reference it, and the auth middleware serves it only to those roles, the same gating as any other passthrough. A `download` block stages its file whatever the extension, so it also covers files outside the recognised list on [[Passthrough files]].

## Built-in: `foundry-install` and `` `fvtt-link:` ``

`foundry-install` renders a copyable install link for the module a vault builds for itself. `fvtt-link:` links to the Foundry document a page builds rather than to its journal page. Both are documented on [[Foundry integration]].

## Writing a custom handler

Put an `.mjs` file in `.vaults/handlers/` that exports a `handler` (or `handlers: []`):

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

The handler API:

- **Inline:** `{ inline: "prefix", render(content, ctx) }`
- **Code block:** `{ codeBlock: "lang", render(content, ctx) }`
- Return `{ html: "..." }` to insert raw markup, or `{ markdown: "..." }` to run the result through the rest of the pipeline, so wikilinks resolve, embeds inline, and dice buttons in the output are picked up.
- `ctx.frontmatter` is the page's parsed frontmatter; `ctx.pagePath` is the page's basename without its extension; `ctx.escape(s)` HTML-escapes a string; `ctx.applyInlineHandlers(s)` runs the other inline handlers over a string, which is how `statblock` supports `dice:` inside a `desc`.

### Browser-side assets

A handler can ship JS and CSS with the deploy:

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

Paths resolve relative to the handler file and must stay inside `.vaults/handlers/`; a path outside it fails the build. The assets bundle into `_handlers.js` and `_handlers.css`, served to the wiki only. In Foundry the HTML a handler produced survives, but its styling and behaviour do not.

This vault includes a `` `clicker:` `` inline handler with a script and a stylesheet: `` `clicker: try me` `` renders as `clicker: try me`.
