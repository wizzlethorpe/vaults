# Wizzlethorpe Vaults: Foundry VTT Module

Sync an Obsidian vault deployed via [vaults-cli](https://github.com/wizzlethorpe/vaults) into Foundry VTT as journal entries (and optionally Actors / Items / Scenes / …). Manifest-based incremental sync, role-based auth, multi-vault, local media cache.

Module ID: `vaults`. Compatible with Foundry V13 + V14.

## Quick start

1. Deploy a vault with `vaults push`.
2. Install this module, click **Sync Vault** in the Journal sidebar.
3. **Add Vault** → paste the deploy URL. The module probes `/_manifest.json`; for multi-role deploys click **Authenticate** to elevate above the public tier.
4. **Sync**. The module fetches the manifest, diffs against the last sync, and pulls only changed pages / media.

## What lands in Foundry

- **Journals.** Each vault folder becomes one `JournalEntry`; each page becomes a `JournalEntryPage`. Folder structure mirrors the vault.
- **Wikilinks.** `[[Page]]` rewrites to a Foundry `@UUID[…]` link. Cross-vault links work too.
- **Media.** Embedded images plus passthrough audio / video / PDFs / JSON download to a per-vault local cache. The `@vault/PATH` prefix inside `foundry.data` strings is rewritten to the cached URL so Scene textures / Playlist sounds work without hardcoding the deploy URL.
- **Bases.** Card / table / list views render natively; cards become content-links.
- **Callouts.** Role-gated callouts on player-visible pages wrap in `<section class="secret">` so non-GM viewers don't see them.

## `dmRole`: per-vault permission cutoff

Pages whose role rank is **below** `dmRole` import as **Observer** ownership (player-visible). Pages at-or-above `dmRole` stay GM-only. Default empty (everything GM-only).

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
---
```

`base` accepts either a compendium UUID (clones the template) or `Type[:subtype]` like `Actor:npc` / `Scene` for a blank doc. Supported blank types: Actor, Item, Scene, JournalEntry, RollTable, Macro, Cards, Playlist.

The doc gets a deterministic id derived from `(vault, page path)`, so re-syncs update in place — user edits to non-overridden fields (HP, conditions, equipped items) survive. Page deletion tears down the doc; manually-edited docs are protected by a vault flag.

`foundry.embed: false` skips embedding the page article into the doc description (useful for stats-only or DM-private notes).

`foundry.id` (16 chars `[A-Za-z0-9]`) pins both the `JournalEntryPage` and its instantiated doc to an explicit id. Lets external macros / scene flags reference the doc by a stable known id. Changing it between syncs leaves the previous doc orphaned (the module never auto-deletes manually-pinned ids).

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
