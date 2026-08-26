# Roadmap

Working notes on where vaults goes next. Nothing here is committed to; it is the reasoning behind each decision so that future-you does not have to re-derive it. Items are roughly ordered by how much they block other work.

## Recently landed

Foundry instantiation tells the truth now. `applyInstance` returns an outcome
instead of bare-returning on seven failure paths; `sync` counts outcomes, not
calls; a `create()` that Foundry validated away is detected rather than
counted as success; and failed pages keep their old hash so they are retried
rather than recorded as synced forever. A role-gated callout leak (a
capitalised role name meant the class selector never matched, so GM-only
blocks were readable by players in Foundry) is fixed and verified in a live
world.

`foundry.base` accepts a priority list, so a vault degrades across worlds with
different content installed, and cloning from a UUID now works for every
instantiable type rather than only Actor and Item. Instantiated documents are
filed under the page's vault directory by default, matching journals.

Roles no longer imply passwords: a role can be granted by Patreon or OIDC
alone, and the login page renders only the methods a deploy actually has.

`settings.md` is the single source of truth for vault properties — the
duplicate CLI flags and config keys are gone. Tokens carry their type and are
refused on top-level navigation. `manifest.ts` and `foundry-meta.ts` are split
out of build.ts. The generated middleware is executable in tests, and
`foundry/test/` covers the pure helpers plus a golden id scheme.

## 1. Separating vaults from Foundry

The problem: vaults is increasingly used for things that have nothing to do with TTRPGs (language documentation, research group sites, course sites), and those deploys still ship a Foundry importer bundle they will never use.

The split is mostly real already. The renderer is Foundry-agnostic. What is actually Foundry-specific is `cli/src/foundry-importer.ts` (writes `_foundry/importer.js` into every deploy), the `foundry.*` frontmatter handling in `build.ts`, and the `/_batch` endpoints in the middleware.

**Do not build a plugin system for this.** Two cheaper moves get nearly all of it:

1. A settings flag that skips the Foundry payload entirely: no `_foundry/`, no `_batch` routes, no `foundry.*` processing. That is the actual complaint.
2. The handler registry **is** the plugin system, and it already supports user-authored handlers with browser JS, CSS, and Foundry opt-in. Make the TTRPG-flavored built-ins (`statblock`, `battlemap`, `dice`) bundled-but-disableable handlers rather than hardcoded ones. Do not stand up a second extension mechanism next to the one that already ships.

A general plugin API earns its keep when a third party wants to write one. Today the third party is us.

## 2. Decoupling roles from passwords

The current model treats a role as a credential. `vaults role add` prompts for a password, and `Features/Patreon login.md` states the rule outright: "Roles always have a password gate," with OAuth as an additive overlay. For a site that should authenticate only through OIDC or Patreon, there is no way to turn the password form and role picker off.

The fix is to stop conflating the two. **Roles say what content is tagged. Authenticators say how a visitor proves one.**

```
roles: [public, student, staff]
auth:
  password: { student: <hash> }           # optional, per role, possibly empty
  oidc:     { staff: { domain: lmu.edu } }
  patreon:  { patron: <tierId> }
```

The login page then renders only the methods that actually exist. No password entries means no password form and no role picker.

**Keep the total order.** Roles are currently a ladder, and for teaching and research the tempting model is a set (student, staff, collaborator are not obviously ranked). But variants are generated per role, and the ladder is what makes "higher tiers see lower content" free. A set model needs one variant per reachable role *combination*, which explodes. Decouple the authentication side only, leave the content model as a ladder.

## 3. Obsidian plugin

Worth doing, but be honest about which problem it solves.

Obsidian plugins have Node access, so wrapping the CLI is straightforward: a ribbon button and commands for build/preview/push, a settings pane for role config. Real quality-of-life, small effort.

It does **not** touch the barrier that actually stops people. Needing a Cloudflare account, an API token, and wrangler is a hosting problem, not a plugin problem. Removing it means the managed platform that `CLAUDE.md` already anticipates, and a plugin that publishes to that service is the real product. Sequence it that way rather than expecting a plugin to fix it.

Practical note: `sharp` (native binary) and `wrangler` are the two dependencies that make bundling awkward. `image_quality: 0` already skips sharp at runtime, so a degraded no-compression path is close to free if needed.

## 4. Foundry module compilation (vfmc)

**Live sync is the primary path. Keep it that way.** Every problem the compile-to-module route runs into is a problem sync does not have:

| Problem | Compiled module | Live sync |
|---|---|---|
| `foundry.base` UUID clones | Needs a bootstrapper or redistribution rights | `fromUuid` is right there |
| v13 / v14 | Build matrix, hardcoded `coreVersion`, separate artifacts | Runs in whatever version is installed |
| Roles | Compile per variant; a `dm` page in a zip is unzippable | Middleware gates per visitor, live |
| Licensing | You ship someone else's content | You ship nothing; the clone happens on their machine, and a system redirect may supply it even without the module |
| LevelDB | Has to be written offline | Foundry writes its own |
| Updates | Version bump plus reinstall | Manifest diff, incremental |

The one thing sync cannot do is **distribution to strangers**: a live-sync vault can't go on the Foundry package listing, because the installer needs a URL, a token, and the module.

### vfmc is internal and not ready

Do not advertise it on the landing site. It is published to npm (`release.sh` does so with `--access public` on every release), which is fine, but nothing should point users at it yet.

What it actually is today: a compendium-pack compiler for a vault's `Compendium/` subtree, with WANDS as its one real user. Known gaps:

1. Requires a hand-authored `data_json` sidecar for every non-RollTable page (`assembleDoc` dereferences `page.foundry.data_json!` unconditionally). WANDS carries 613 sidecars for 668 pages.
2. Supports 3 document types (Item, Actor, RollTable) against the sync module's 8.
3. Hardcodes `DEFAULT_STATS`: `systemId: dnd5e`, `systemVersion: 5.3.0`, `coreVersion: 14.359`. Already stale; a live world reports 5.3.3 / 14.367.
4. Ignores the UUID form of `foundry.base` and fails with `unsupported foundry.base type`, which names neither cause nor fix. It should report those pages as sync-only.
5. Needs hand-written `flags.vfmc.packs` in `module.json`.
6. Derives ids with a different scheme than the sync module (base64-filtered vs hex), so the two disagree for the same page.
7. Reimplements wikilink and markdown rendering separately from `links.mjs`.
8. Compiles compendium documents only. A vault's pages don't come along, so it is not "compile a vault".

### Compendium-only modules already work

For **vault-authored** content the offline path is done and shipping. WANDS is 648 pages of blank-type bases (`Item:feat`, `Actor:npc`, `RollTable`, …) with sidecars, and vfmc compiles complete LevelDB packs with no Foundry in the loop. The base data is in the vault, so nothing needs resolving.

Only the **UUID-clone** form has the problem, and even then Foundry itself is not required: the source pack is a LevelDB directory on disk and `@foundryvtt/foundryvtt-cli` reads it as plain Node (`molten unpack` does exactly this). The real constraint is provenance and rights, not runtime.

So: **the UUID-clone form is a live-sync idiom, not a distribution idiom.** Either you authored the content and can ship it, or you didn't and can't.

#### Systems can redirect a module's packs, so a UUID is more portable than it looks

Verified live, and it corrects an earlier assumption here. dnd5e ships a `moduleRedirects` table mapping the three official 2024 books onto its own packs:

```js
"dnd-monster-manual": {
  "Compendium.dnd-monster-manual.actors": "Compendium.dnd5e.actors24",
  ...
}
```

A page whose base is `Compendium.dnd-monster-manual.actors.Actor.mmGuard000000000` therefore instantiates fine in a world where that module is **installed but disabled**, or absent entirely, because `fromUuid` transparently resolves it to `Compendium.dnd5e.actors24`. Marlo Mystery's Prison Guard does exactly this: the resulting Actor records `compendiumSource: Compendium.dnd5e.actors24.Actor.mmGuard000000000`.

Two consequences:

- A vault built against official-book UUIDs is considerably more portable than "the reader needs the book". It works for anyone on a dnd5e version carrying the redirect. This does not generalise: it is a courtesy of that system for that content, not a Foundry-wide guarantee, and third-party modules have no such mapping.
- **Never infer reachability from module state.** `game.modules.get(id)?.active` reports a working package as missing. The only reliable test is asking Foundry to resolve a UUID from the pack, which is what the preflight does.

### If the module build is ever revisited, build it from the world

The most promising shape is an export from a *synced world* rather than a compile from the vault. Sync has already done the mapping: correct schema, correct `_stats`, clones resolved, embedded items resolved, media downloaded, links rewritten. Exporting from there packages what is already correct instead of recomputing it, and roles come along free because the world holds exactly the role you synced as.

Two honest limits: Foundry probably cannot finish the job in-app, since module packs are LevelDB under `Data/modules/<id>/packs/` and a client module can write files via `FilePicker` but cannot make the server build a pack, so expect a two-step flow. And publishing stops being headless, which is a real regression for a rulebook that re-releases often.

### Considered and rejected

Recorded so this doesn't get re-derived:

- **Client-side (browser) module builder.** Attractive because `/_batch` already gates by role, so "the content they can see" falls out for free. Killed by LevelDB: it cannot be written in a browser, so the output needs either a bootstrapper (no longer a pack-only module) or a hand-rolled LevelDB writer. Building at `vaults push` time gets pack-only output for free, since Node can run the pack tooling.
- **Install-time hydration via a bootstrapper esmodule.** Resolves `foundry.base` on the installer's machine and never redistributes source content. But it is not a compendium-only module, which is what content modules actually are, and module packs are locked by default so hydration needs somewhere to write.
- **`vaults` as a shared hydration runtime** that content modules declare via `relationships.requires`. Elegant, and `_stats.compendiumSource` is a real native field for the provenance half, but Foundry gives that field provenance semantics only, with no native derivation. It would also make vaults a runtime dependency of published content, a much heavier commitment than being a build tool.

## 5. Consolidate the Foundry mapping

Promoted out of item 4, because it is a prerequisite for almost everything else and stands on its own.

**`foundry/scripts/` is already CLI-owned code.** The installed module is a host; the sync logic is bundled by the CLI into `dist/foundry-importer.bundle.js`, shipped as `_foundry/importer.js`, and evaluated from the deploy (see CLAUDE.md, "Testing a change to `foundry/scripts/`"). That makes vfmc's separate reimplementation the odd one out, not one of two peers.

The duplication is concrete: id derivation and wikilink-to-`@UUID` rewriting exist independently in `foundry-compiler/src/index.ts` and `foundry/scripts/links.mjs`, with different hash seeds. `util.mjs` even documents its own duplication of `cli/src/escape.ts`, citing a boundary that the CLI's own esbuild step already crosses.

Classified by whether it touches Foundry at all:

| Stays in the module | Can move up |
|---|---|
| `instance.mjs` (660) — `fromUuid`, Document.create/update | `links.mjs` (403) — wikilink to `@UUID`, HTML transform |
| `media.mjs` (404) — FilePicker, world data dir writes | `sync.mjs` (321) — manifest diffing, **zero** Foundry globals |
| `main.mjs` (692) — hooks, UI, dialogs | `api.mjs` (113) — `_batch` client, plain `fetch` |
| `settings.mjs`, `handler-assets.mjs`, `importer*.mjs` | `ids.mjs` (38), `util.mjs` (28), `parser.mjs` (3) |

Roughly 900 of 4,220 lines are already pure, and they are precisely the lines vfmc duplicates. Target shape: a **pure planner plus per-environment executor**. The planner emits document intents; the live module calls `Document.create`, vfmc writes LevelDB, the CLI does either.

Blockers to plan for: the two id schemes are incompatible, so unifying forces a `forceFull` re-sync and orphans documents in existing worlds; `links.mjs` uses DOM (`createDocumentFragment`), free in a browser and needing a shim in Node; and vfmc covers 3 document types against the module's 8, so consolidation forces that reconciliation.

## 6. Composing an adventure from other creators' content

The goal: publish an adventure that uses The MAD Cartographer's maps, James
RPG Art's scenes and Michael Ghelfi's ambience, where **the vault never
contains any of it**. Each reader gets whatever their own subscriptions
entitle them to, and the licensing question stays between them and the
creator. Same principle as `foundry.base` already: ship a pointer and a diff,
never a pixel. It is also why baking content into a distributable module was
such a poor fit (see section 4) — the moment the artifact carries the
content, you are redistributing it.

### Most of this works today, or nearly

Creators like The MAD Cartographer and Forgotten Adventures ship real Foundry
modules with compendium packs, so their content is addressable by ordinary
UUID and needs nothing new:

```
Compendium.mad-modcaverns.mad-modcaverns-maps.Scene.DiQAiq8wUMRGevDg
Compendium.fa-battlemaps.maps.Scene.0M8gKipOIXQMqdEz
```

One real vault has 65 Scene packs indexed, 2,099 scenes between them. The
priority list added in the `foundry.base` work is exactly the "use it if the
reader owns it" mechanism.

**This used to be blocked on our side** and no longer is: cloning from a UUID
was limited to Actor and Item, so every compendium Scene was skipped. It is
now gated on the same list as the blank-document form (`BLANK_DOC_TYPES` in
foundry/scripts/foundry-base.mjs), because the real constraint is identical —
the type needs a world collection to be created in.

### Moulinette: research

Creators often distribute through both channels. The first sketch made
Moulinette another rung on the `foundry.base` ladder; that was wrong. `base`
names a *document template* to clone, and a Moulinette Map is an **image**, so
it has no place there. It belongs where asset paths already live, in the
`foundry.data` overlay, next to `@vault/`:

```yaml
foundry:
  base:
    - Compendium.mad-modcaverns.mad-modcaverns-maps.Scene.DiQAiq8wUMRGevDg  # owns the module
    - Scene                                                                 # doesn't
  data:
    grid: { size: 140 }
    background:
      src: "@moulinette/10698/scenes/modular-cavern-01.webp"   # if subscribed
```

The two mechanisms compose rather than compete, and they degrade differently.
`base` degrades in **fidelity**: a compendium Scene clone brings walls,
lighting and sounds, a blank `Scene` brings none. A `@moulinette/` path
degrades by **dropping its container**, so an unsubscribed reader gets a scene
with no background rather than one pointing at a file that isn't there.

**Asset types** (numeric enum in the module bundle):

```
1 Scene   2 Map   3 Image   5 Actor   6 Item
7 Audio   8 JournalEntry   9 Playlist   10 Macro   98 ScenePacker
```

**Supported vs internal.** `game.modules.get("moulinette").api` has exactly
two methods, `searchUI()` and `searchAssets(terms, type)`, and searchAssets
accepts only Image (3), Audio (7) and Map (2).

We do not use it. It is a *search*, and it is unfit for resolving a reference
three ways over: it matches `asset.name`, which for a file with no explicit
name is `prettyMediaName(filepath)` (hyphens and underscores to spaces, title
case, extension in parentheses), so `cavern_01.webp` indexes as "Cavern 01
(webp)" and never matches its own filename; it reads only page 0 of
`PAGE_SIZE = 100`; and it ranks by relevance, so two readers could resolve one
reference to different assets.

What we use instead is the index those searches run over. `POST /all-assets`
returns every asset the reader can access, `{ assets, packs }` keyed by
`pack_ref`, and the `mou-cloud-cached` collection loads it once into
`cache.allAssets`. Reading it is entitlement-awareness for free, same as
search, but exact and complete. Each cached asset keeps `pack_id`
(the `pack_ref`) and `url` (the filepath), which is the pair we match on.

`collection.selectAsset(asset)` is the correct download entry point: it fetches
the `/asset/<id>` descriptor and then downloads, returning the local path.
Calling `downloadAsset` directly with a browser asset throws `Invalid
BaseURL?`, because it wants the descriptor's `base_url` / `file_url` / `deps`.

Everything that imports a *document* is internal, reached through the module
object but with no contract:

```
collections.find(c => c.getId() == "<collection-id>").fromDropData(assetId, data)
  → cloudclient.apiGET(`/asset/${assetId}`)      // descriptor
  → downloadAsset(descriptor)                     // fetches the JSON
  → utils.foundry.importActor(JSON.parse(...), folder, false)
```

Collection ids: `mou-cloud`, `mou-cloud-cached`, `mou-cloud-private`,
`mou-compendiums`, `mou-local`, `mou-gameicons`, `mou-bbc-sounds`,
`mou-fontawesome`. `getSessionId()` is published on the module object.

**Three findings that shaped the scope:**

- Moulinette asset ids are **integers**. `/asset/9` returns a descriptor;
  `/asset/0` returns 404 and throws.
- An imported document's `_stats.compendiumSource` does **not** carry one. It
  records a product label like
  `Compendium.the-fluffy-folio-volume-01.the-fluffy-folio-vol-01.9c3saETmlSzvyINU`
  which does not resolve — no such pack is installed. It is also the legacy
  4-segment UUID form, which breaks doc-type derivation (second-to-last
  segment is the pack name, not a type).
- **A malformed id fails silently and dangerously.** Asking for
  `/asset/9c3saETmlSzvyINU` returned asset `9` — the server truncated at the
  first non-digit and handed back an unrelated audio track from a different
  creator. A reference that is wrong-but-digit-leading imports someone else's
  content rather than erroring.

That last point is why cloud **documents** are out of scope: a feature whose
failure mode is "quietly inserts the wrong content into your world" is worse
than no feature. Maps, images and audio avoid it entirely by being matched on
creator + pack + exact filename rather than an id.

### Scope

1. ~~**Allow cloning from a UUID for every instantiable type.**~~ Done. The
   old Actor/Item-only restriction rested on a reason that was not true of the
   code (the description embed is already optional), and it was skipping every
   compendium Scene.
2. ~~**`@moulinette/<pack_ref>/<filepath>` as an asset reference.**~~ Done, in
   `foundry/scripts/moulinette.mjs`. Not a `foundry.base` rung after all: a
   Moulinette Map is an *image*, and `base` names a document template, so it
   belongs alongside `@vault/` in the `foundry.data` tree rewrite instead.

   Resolved against `/all-assets` — the reader's whole entitled index, which
   the cached cloud collection already loads — matching exactly on `pack_ref`
   and filepath. `pack_ref` is the number in a marketplace URL
   (`/marketplace/product/10698/czepeku-scenes/abandoned-mine-entrance`); the
   two slugs after it are display names run through `.slugify()`, so they move
   when a creator renames a pack and are not safe to key on.

   The first attempt went through the public `api.searchAssets` and was wrong
   three ways, all of which a live world would have hit at once: the index
   matches a *prettified* display name, so `cavern_01.webp` (indexed as
   "Cavern 01 (webp)") never matched its own filename; only page 0 of 100 is
   ever read; and `downloadAsset` wants the `/asset/<id>` descriptor, not the
   browser asset, so it threw `Invalid BaseURL?` regardless. Indexing rather
   than searching removes all three, and drops the Map/Image/Audio limit,
   which was only a restriction of that public wrapper.

   Two internal dependencies remain: `collections` and `cache.allAssets`. Both
   are probed rather than assumed, and a miss degrades to an unresolved
   reference plus one warning.
3. **Not doing:** cloud documents (`Scene 1`, `Actor 5`, `Item 6`, …) via
   `fromDropData`.

### Open questions

- **`pack_ref` stability.** It is what the marketplace links by, so it is the
  most durable handle on offer, but whether it survives a catalogue rebuild is
  still unconfirmed.
- **Talk to the Moulinette developers.** The API we need is one method away
  from being supported; a documented `resolveAsset(creator, pack, file)` would
  remove the last internal dependency. Worth asking rather than reverse
  engineering a minified bundle forever.
- **The reverse direction.** How would a vault creator publish *their* assets
  *into* Moulinette, so a vault becomes a Moulinette-visible source? That
  inverts the integration and is a much larger question — it touches
  discovery, which is the part of Moulinette's product that a decentralised
  publishing model does not replace (see the note in section 7).

## 7. Vaults as decentralised distribution

An idea worth recording: vaults already has most of what a content
marketplace sells.

| Moulinette provides | vaults already has |
|---|---|
| Entitlement checking | Patreon/OIDC role gating, enforced by the middleware |
| Per-user access to creator content | Role variants, one deploy per creator |
| A client that pulls content into Foundry | The Foundry module, incremental sync |
| Auth for that client | `/connect` bearer tokens, per vault |
| Multiple creators in one world | Multi-vault registration (`listVaults()`) |

There is an argument this is *structurally better* for entitlement: gating
happens at the creator's own origin, so a non-subscriber is not filtered by a
client module they could patch — the premium files are simply not in the
variant the server returns.

What is missing:

- **Cross-vault addressing.** No way to say "this page's ambience lives in
  vault X". The hard part is identity: vault ids derive from the URL, so a
  creator changing domains would break every reference. A stable creator id
  independent of hosting is painful to retrofit and should be settled early.
- **Dependency declaration**, so vault A can tell the module "I use vault B
  at URL X" and offer to register it.
- **A catalogue.** This is the real gap and it is not technical. Moulinette's
  actual product is search across creators; decentralised publishing gives
  distribution and entitlement but no discovery. Building an index
  recentralises exactly the part that matters.
- **Hosting economics.** Cloudflare Pages caps a deploy at 20,000 files (the
  reason the MCP prototype was dropped), and each creator carries their own
  bandwidth. Fine for a rules vault, a real constraint for an asset library.

So: aim to be the publishing substrate something else can index over, rather
than the storefront.

## Near-term work

1. **Sync does not reconcile world state.** It diffs the remote manifest
   against `lastManifest`, so a document deleted in the world is invisible to
   every later incremental sync: it reports "up to date" forever. Combined
   with a failed instantiation this is how a world drifts quietly. Force Sync
   is the only repair today. The fix is cheap — the loop already knows every
   page carrying a `foundry.base`, and `collection.get(id)` is an in-memory
   check, so running it over unchanged pages would let sync notice and
   re-create what is missing.

2. **`compendiumSource` is create-only.** Existing documents never gain the
   provenance trail retroactively, because the update path patches an existing
   document rather than re-deriving it. Defensible, but decide whether
   heal-on-update is wanted.

3. **Moulinette rung for Map / Image / Audio.** See section 6 for the research
   and the exact call chain.

## Smaller open items

- `vaults preview` renders pages that contain only base code as raw base code rather than the rendered view.
- Foundry-side test coverage is only partial. `foundry/test/` now covers the pure helpers via the root `test:foundry` script, but everything touching Foundry globals (`Document.create`, `FilePicker`, `game.scenes`) still needs a mock layer, so `instance.mjs`'s create/update paths and `media.mjs` remain untested. Verifying those currently means a real world plus a vault push.
- No `sitemap.xml` or `robots.txt`. Irrelevant for private campaign vaults, but the course and research sites want to be indexed.
