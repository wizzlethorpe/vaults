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
- **A world without the type degrades to `text`, with a warning.** Same as a `foundry.source` rung that cannot resolve. Only the Foundry module can do this, since it runs inside the world and can ask what types exist; the compiled `grafts.json` carries what the vault declared and cannot know the reader's system.
- **Divergence between package shapes is no longer a risk.** `compendium` and `adventure` both compile from the one entry list `journalEntries` writes, so the overlay lands in `foundry-grafts.ts` once.

This shipped once (8a6749b) against the pre-graft architecture and was lost in the graft rewrite; the decisions above are that implementation's, and its spec conformance tests are in history to crib from.

## 2. Separating vaults from Foundry

Vaults is increasingly used for things with nothing to do with TTRPGs, and those deploys should not carry a Foundry payload. `foundry.package: none` handles the deploy side already.

What remains is the built-ins: `statblock`, `battlemap` and `dice` are hardcoded rather than bundled-but-disableable handlers. **Do not build a plugin system for this.** The handler registry already is one, with user-authored handlers, browser JS and CSS, and Foundry opt-in. A general plugin API earns its keep when a third party wants to write one, and today the third party is us.

## 3. Obsidian plugin

Straightforward, and real quality of life: plugins have Node access, so a ribbon button for build/preview/push and a settings pane for roles is small work.

Be honest that it does not touch the barrier that actually stops people. Needing a Cloudflare account, an API token and wrangler is a hosting problem. Removing it means the managed platform, and a plugin that publishes to *that* is the real product. Sequence it that way.

## 4. One Foundry generation per vault

Not built, and not needed while v14 is the only target, but the decision is made: supporting several means deploying a separate copy of the vault per generation, not branching inside pages.

This separates two things the Moulinette work conflated. A `foundry.source` priority list is for **content availability**, meaning does this reader own that pack. We also used it for **version compatibility**, and those are independent axes, so every rung became a guess about two variables and the combinations multiply past what anyone can test. Declared instead, probably as a setting, it gives one honest answer up front, and the generation-skew warning gets a better question to ask: does this pack match what the vault was built for, rather than does it match this world.

## 5. Vaults as decentralised distribution

Vaults already has most of what a content marketplace sells: entitlement checking, per-user access, a client that pulls content into Foundry, auth for that client, and multiple creators in one world. Structurally it is *better* for entitlement than a client-side gate, because a non-subscriber is not filtered by a module they could patch. The premium files are simply not in the variant the server returns.

Missing: **cross-vault addressing** (the hard part is identity, since vault ids derive from the URL and a creator changing domains breaks every reference, so settle a stable creator id early), **dependency declaration**, and **a catalogue**. The catalogue is the real gap and it is not technical. Search across creators is Moulinette's actual product, and building an index recentralises exactly the part that matters.

So: aim to be the publishing substrate something else indexes over, rather than the storefront.

## Smaller open items

- `vaults preview` renders pages containing only base code as raw base code rather than the rendered view.
- Foundry-side coverage is partial. The pure helpers are tested, but anything touching Foundry globals (`FilePicker`, `game.scenes`) needs a mock layer, so `assets.mjs` and the freshness prompt are verified only against a live world.
- Cloudflare Pages caps a deploy at 20,000 files. Fine for a rules vault, a real constraint for an asset library.
