# Wizzlethorpe Vaults: Foundry VTT Module

Sync an Obsidian vault deployed via [vaults-cli](https://github.com/wizzlethorpe/vaults) into Foundry VTT as journal entries (and optionally Actors / Items / Scenes / …). Manifest-based incremental sync, role-based auth, multi-vault, local media cache.

Module ID: `vaults`. Requires Foundry V14 or newer.

## Quick start

1. Deploy a vault with `vaults push`.
2. Install this module, click **Sync Vault** in the Compendium sidebar.
3. Install the vault's own module from its deploy, `<vault>/_foundry/module.json`, and enable it alongside this one and [graft](https://github.com/wizzlethorpe/graft). Building it prompts once for a token; a role-gated vault serves each reader only the pages their role may read.
4. **Sync**. The module fetches the manifest, diffs against the last sync, and pulls only changed pages / media.

## What lands in Foundry

A vault syncs into its own **compendium packs**, one per document type, grouped in a sidebar folder named after the vault. Nothing else writes to them, so a sync can always replace their contents. Use **Import All** (with "Keep Document IDs") to bring content into the world; what you import is then yours, and later syncs update the pack rather than your copy.

A gated vault's packs are set GM-only on every sync. Foundry gates compendium visibility per pack by user role, with no per-document filter, so a player-visible pack would expose every name and image in it; per-page roles are carried on the documents instead and take effect on import. This is set explicitly, because an unconfigured world pack is player-readable by default. A public vault's packs are left browsable. Requires Foundry v14, whose Import All preserves document ownership.

- **Journals.** Each vault folder becomes one `JournalEntry`; each page becomes a `JournalEntryPage`. Folder structure mirrors the vault.
- **Wikilinks.** `[[Page]]` rewrites to a Foundry `@UUID[…]` link. Cross-vault links work too.
- **Media.** Embedded images plus passthrough audio / video / PDFs / JSON download to a per-vault local cache. The `@vault/PATH` prefix inside `foundry.data` strings is rewritten to the cached URL so Scene textures / Playlist sounds work without hardcoding the deploy URL.
- **Bases.** Card / table / list views render natively; cards become content-links.
- **Callouts.** Role-gated callouts on player-visible pages wrap in `<section class="secret">` so non-GM viewers don't see them.

## `foundry.player_role`: what players can read

Set in the vault's `settings.md`, not here. It names the **highest role players are allowed to read**: pages at that role or below import as **Observer** ownership, everything above stays GM-only, and an empty value (the default) keeps all of it GM-only.

The named tier is one players *can* see, not the first they cannot. It replaces the module's old `dmRole` setting, which named the first secret tier and was set per GM — which pages are player-facing is a fact about the vault, so the vault states it once.

Combined with `<section class="secret">` wrapping, a single public-facing journal can carry inline DM notes that players never see.

## Auto Actors / Items / Scenes / …

Pages with a `foundry:` frontmatter block spawn a linked document alongside the journal:

```yaml
---
foundry:
  base: Compendium.dnd5e.monsters.Actor.bandit  # UUID, OR Type[:subtype] for a blank doc
  data:                                         # deep-merge overlay
    system:
      attributes:
        hp:
          value: 22
  embed: false                                  # optional, default true
  sync: false                                   # optional, default true — skip Foundry entirely
  journal: false                                # optional, default true — doc only, no journal page
---
```

`base` accepts either a compendium UUID (clones the template) or `Type[:subtype]` like `Actor:npc` / `Scene` for a blank doc. Supported blank types: Actor, Item, Scene, JournalEntry, RollTable, Macro, Cards, Playlist.

The doc gets a deterministic id derived from `(vault, page path)`, so re-syncs update in place — user edits to non-overridden fields (HP, conditions, equipped items) survive. Page deletion tears down the doc; manually-edited docs are protected by a vault flag.

`foundry.embed: false` skips embedding the page article into the doc description (useful for stats-only or DM-private notes).

`foundry.sync: false` keeps the page out of Foundry entirely — no `JournalEntryPage`, no derived doc, and wikilinks to it from other pages fall back to plain text. The page still renders on the wiki. Use it for material that belongs in the vault but not at the table: toolchain notes, build docs, drafts. Setting it on a page that synced previously deletes its `JournalEntryPage` from the pack on the next sync, exactly as if the page had been removed from the vault.

`foundry.journal: false` makes the derived document *without* the `JournalEntryPage` that normally accompanies it. For pages that exist to carry a Scene or an Actor and whose article adds nothing to the sidebar. Setting it on a page that already synced deletes its journal page on the next sync, so it is not a one-way door. The article still renders on the wiki, and the description embed is suppressed automatically — there would be no page left to point at.

The three are independent: `sync` drops everything, `journal` drops only the page, `embed` drops only the article inside the doc's description. `foundry.embed: false` and `foundry.sync: false` are not the same thing: `embed` only suppresses the article inside a derived doc's description, and the journal page is still created.

`foundry.id` (16 chars `[A-Za-z0-9]`) pins both the `JournalEntryPage` and its instantiated doc to an explicit id. Lets external macros / scene flags reference the doc by a stable known id. Changing it between syncs leaves the previous doc orphaned in the pack (the module never auto-deletes manually-pinned ids).

## Handler-asset import

If the vault ships handlers with browser-side assets opting into Foundry (`assets.targets.foundry.{styles,scripts}`), GMs can pull them in via the per-vault settings dialog. Both default off; enabling JS import shows a confirmation and re-prompts once per session if the bundle changes. Bundles are role-gated, so `dm`-tier handler code isn't accessible to public visitors.

## Public API

```js
globalThis.Vaults = {
  sync(vaultId, { forceFull = false }),  // run a sync for one vault
  listVaults(),                          // [{ id, label, url, role, public }, …]
  getVault(id),                          // full vault entry
  openVaultsDialog(),                    // open the Vaults dialog
};
```

## Limitations

- **Secret blocks leak through `@Embed` on derived Items / Actors.** Foundry's text enricher decides whether to hide `<section class="secret">` content based on the *parent* document's permissions, not the embedded page's, so a player who owns an Item sheet sees secret blocks the underlying journal page would have hidden. The journal page itself still hides them correctly. Workaround: keep DM-only material on dedicated dm-role pages, or set `foundry.embed: false`.
- Backlinks (rendered in the wiki sidebar) don't carry into Foundry.
- One image cache per vault; first sync of a large vault takes a minute.

## License

MIT
