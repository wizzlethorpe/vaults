# Wizzlethorpe Vaults: Foundry VTT Module

Read an Obsidian vault published with [vaults-cli](https://github.com/wizzlethorpe/vaults) into Foundry VTT. The vault is compiled to a graft entry list at build time; this module is the [graft](https://github.com/wizzlethorpe/graft) provider that fetches that list, resolves what it references, and hands it to graft to build. Pushing new content never means reinstalling anything.

Module ID: `vaults`. Requires Foundry V14 or newer, and graft.

## Quick start

1. Deploy a vault with `vaults push`.
2. Install this module and graft.
3. Install the vault's own module from its deploy, `<vault>/_foundry/module.json`, and enable all three. That module holds no code: a manifest, its packs, and one line naming the vault.
4. This module offers to build it. A role-gated vault asks once for a token (open the vault, sign in, paste it back); each reader gets only the pages their role may read.

That first offer is worded here rather than by graft, because only this module knows a role-gated vault needs connecting to first. Whether anything has been built is graft's own `anyBuilt`: this module's `grafts.json` names a vault to fetch rather than the entries themselves, so until a build has run there are no ids for graft's usual check to look up. The offer returns each world load until a build is attempted, since an unbuilt vault is empty packs and nothing else.

On later world loads, the module compares the deploy's content hash against the last build and offers a rebuild when the vault has moved. Declining records the answer, so one push asks once. Downloads are cached by content hash: a rebuild fetches only bytes that changed.

## What lands in Foundry

How content is delivered is the vault's `foundry.package` setting:

- **`adventure`** — the whole vault becomes one Adventure document. Import it once and every internal link resolves to the copies you imported; a second import updates them in place, since ids are deterministic. Folders travel with it.
- **`compendium`** — browsable packs, one per document type, for a reference library nobody imports as a unit.

Either way:

- **Journals.** Each vault folder becomes one `JournalEntry`; each page a `JournalEntryPage`.
- **Wikilinks.** `[[Page]]` rewrites to a Foundry `@UUID[…]` link at build time.
- **Media.** Images, audio, and other files referenced by documents download into a per-vault cache under the world, keyed by the variant they came from.
- **Ownership.** The vault's `foundry.player_role` names the highest role players may read; pages at or below it arrive with Observer ownership, everything else GM-only. Empty (the default) keeps all of it GM-only.

## Page frontmatter

A page with a `foundry:` block also produces a document:

```yaml
---
foundry:
  source: Compendium.dnd5e.actors24.Actor.mmMage0000000000  # UUID, or Type[:subtype] for a blank doc
  patch:                                                    # merged over the source, RFC 7386 style
    system:
      attributes:
        hp:
          value: 22
  patch_json: Scenes/home.json   # a sidecar export, merged under the inline patch
---
```

`source` accepts a compendium UUID (the reader's own copy supplies the document and the patch says only what differs), a list of UUIDs to try in order, or `Type[:subtype]` like `Actor:npc` for a document the page carries whole. The document id derives from the page path; pin one with `patch._id`.

Optional keys, all default on/off as noted:

- `sync: false` — the page stays out of Foundry entirely.
- `journal: false` — the document is made but no journal page; links to the page open the document.
- `embed: false` — the page's prose stays out of the document's description.
- `folder: Some/Path` — files the document there instead of where the page lives.

A player-visible page's journal body carries two renders: the GM's full page inside a Foundry secret section (stripped for anyone below owner), and the player variant's render in the open. Players see exactly what the public site would show them — DM callouts, base rows for DM-only pages, and every other difference included — and the GM reads their own full page.

A wikilink always opens the page (its journal page, or its document when `journal: false`). To link a page's *document* while its journal page exists — a statblock, a scene, a macro — use the inline handler: `` `fvtt-link: Toggle Feast` `` (with `` |label `` for custom text). On the wiki it is an ordinary page link.

Any HTML element with the `vaults-web-only` class is stripped from journal bodies — for blocks that belong on the wiki but not in Foundry, like the battlemap viewer on a scene page. Handlers set it on their wrapper; a page can use it on raw HTML of its own.

## License

MIT
