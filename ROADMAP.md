# Roadmap

Where vaults goes next, and the reasoning behind each call so future-you does not re-derive it. Nothing here is committed to. Ordered roughly by how much each blocks the rest.

## 1. Customising the journal side of a page

Today a page becomes a `text` JournalEntryPage and that is the whole story. `foundry.journal` is a boolean that says whether to make one at all. Foundry has more to offer: `title.show` and `title.level`, `category`, and page *types*.

**The types are mostly not core.** Foundry v14 ships four (`text`, `image`, `pdf`, `video`); dnd5e adds five (`class`, `map`, `rule`, `spells`, `subclass`). So the interesting ones, a Map Location page with clickable notes and a Spell List, are system-provided and only exist in a dnd5e world. That is the same availability problem `foundry.source` priority lists solve, and it probably wants the same answer rather than a new one.

The natural shape is the idiom the vault already uses. `foundry.data` deep-merges into the instantiated document, so `foundry.journal` becomes an overlay onto the JournalEntryPage, with `false` still meaning "do not make one":

```yaml
foundry:
  journal:
    type: spells
    title: { show: false }
    system: { type: class, grouping: level }
```

Decided:

- **A non-text page drops the article body.** An `image`, `video` or `pdf` page's content *is* its `src`, so there is nowhere for prose to live. Say so at build time rather than silently discarding it.
- **A world without the type degrades to `text`, with a warning.** Same as a `foundry.source` rung that cannot resolve. Only something running inside the world can do this, since it has to ask what types exist; the compiled `grafts.json` carries what the vault declared and cannot know the reader's system. That makes it a graft-side decision, not a build-side one.

This shipped once (8a6749b) against the pre-graft architecture and was lost in the graft rewrite; the decisions above are that implementation's, and its spec conformance tests are in history to crib from.

## 2. Separating vaults from Foundry

The core CLI knows nothing about TTRPGs or Foundry. `@wizzlethorpe/vaults-ttrpg`, in `ttrpg/`, carries the statblock, battlemap, dice, `fvtt-link` and `foundry-install` handlers, the `foundry` and `zip_assets` settings, the Foundry migrations and the `grafts.json` build. Core finds it by importing it by name (`cli/src/addons.ts`) and everything it contributes goes through one contract, `cli/src/addon.ts`, published as `@wizzlethorpe/vaults/addon`. The two release together at one version, so the contract never has to work across versions.

What is left is the part of the contract that is still markup. The add-on reads the article HTML core renders, and leans on strings core emits without promising them: the `vaults-web-only` class, the `data-vaults-role` and `data-callout` attributes, `class="bases-block"`, and the `<page>.body.html` file. A change to any of them in core breaks the Foundry build with no type error. They want to be named constants on the contract, with the add-on's tests as the check.

## 3. Obsidian plugin

Straightforward, and real quality of life: plugins have Node access, so a ribbon button for build/preview/push and a settings pane for roles is small work.

Be honest that it does not touch the barrier that actually stops people. Needing a Cloudflare account, an API token and wrangler is a hosting problem. Removing it means the managed platform, and a plugin that publishes to *that* is the real product. Sequence it that way.

## 4. One Foundry generation per vault

Not built, and not needed while v14 is the only target, but the decision is made: supporting several means deploying a separate copy of the vault per generation, not branching inside pages.

This separates two things the Moulinette work conflated. A `foundry.source` priority list is for **content availability**, meaning does this reader own that pack. We also used it for **version compatibility**, and those are independent axes, so every rung became a guess about two variables and the combinations multiply past what anyone can test. Declared instead, probably as a setting, it gives one honest answer up front, and the generation-skew warning gets a better question to ask: does this pack match what the vault was built for, rather than does it match this world.

## 5. Vaults as decentralised distribution

Vaults already has most of what a content marketplace sells: entitlement checking, per-user access, a per-role grafts.json with scoped asset tokens, and multiple creators in one world. Structurally it is *better* for entitlement than a client-side gate, because a non-subscriber is not filtered by a module they could patch. The premium files are simply not in the variant the server returns.

Missing: **cross-vault addressing** (the hard part is identity, since vault ids derive from the URL and a creator changing domains breaks every reference, so settle a stable creator id early), **dependency declaration**, and **a catalogue**. The catalogue is the real gap and it is not technical. Search across creators is Moulinette's actual product, and building an index recentralises exactly the part that matters.

So: aim to be the publishing substrate something else indexes over, rather than the storefront.

## Smaller open items

- `vaults preview` renders pages containing only base code as raw base code rather than the rendered view.
- Cloudflare Pages caps a deploy at 20,000 files. Fine for a rules vault, a real constraint for an asset library.
