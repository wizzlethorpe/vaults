# Wizzlethorpe Vaults: Foundry VTT Module

Sync an Obsidian vault deployed via [vaults-cli](https://github.com/wizzlethorpe/vaults-cli) into Foundry VTT as journal entries (and optionally Actors / Items). Manifest-based incremental sync, role-based auth, multi-vault support, local image cache.

## Status

v0.6.0. Public and multi-role vaults sync end to end. Wikilinks, image embeds, callouts, Bases (cards / table / list), and folder hierarchy all import. Page transclusion (`![[Page]]`) is dropped silently for now.

## How it works

1. Deploy a vault with `vaults push` (Cloudflare Pages).
2. In Foundry, install this module and open **Manage Vaults** from the Journal sidebar.
3. Click **Add Vault**, paste your vault URL. The module probes `/_manifest.json` for `name` and `auth.required`:
   - **Public vault** (single-role, no middleware): jumps straight into the per-vault settings dialog. No sign-in.
   - **Multi-role vault**: same, but you can click **Authenticate** later to elevate above the public tier.
4. Click **Sync**. The module fetches the manifest, diffs against its last-seen state, pulls only changed pages and images, and creates / updates journals.

The bearer token is the only credential, no copy-pasting tokens. Re-sync is incremental; manifest hashes fold in frontmatter, so even a role flip or title rename triggers an update.

## Foundry compatibility

Compatible with V13. Verified on V14.

## Module ID

`vaults`

## What lands in Foundry

- **Journals.** Each vault page becomes a `JournalEntry` under the vault's root folder. Folder structure mirrors the vault.
- **Wikilinks.** `[[Page]]` rewrites to `@UUID[JournalEntry.<id>]{label}` so cross-references stay clickable inside Foundry, including across multiple connected vaults.
- **Images.** Embedded images are downloaded to a per-vault local cache; rewritten `<img src>` points at the cached file so journals work offline.
- **Bases.** Cards, table, and list views render natively. Card hrefs become `data-uuid` content-links, so clicking a card navigates to the linked journal.
- **Callouts.** Standard callouts render with the vault's CSS. Role-gated callouts inside player-visible pages are wrapped in `<section class="secret">`, so non-GM viewers don't see them even when they can see the surrounding article.

## Multi-vault

You can connect any number of vaults to a single Foundry world. Each vault gets its own row in the **Manage Vaults** dialog, its own root folder, its own image cache, and its own auth state. Removing a vault tears down its journals, derived Actors / Items, and cached images.

## Per-vault permission gate (`dmRole`)

Each vault has a `dmRole` setting that controls journal ownership on import:

- Pages whose role rank is **below** `dmRole` import as **Observer** ownership (visible to all players).
- Pages at-or-above `dmRole` stay **GM-only**.

Combined with the `<section class="secret">` wrapping, this lets you ship a public-facing journal with DM secrets inline; players see the article, GMs see everything.

Default is empty (everything imports GM-only).

## Auto Actors / Items

Pages with the right frontmatter spawn linked documents alongside the journal:

```yaml
---
foundry_base: Compendium.dnd5e.monsters.Actor.bandit
foundry:
  system.attributes.hp.value: 22
---
```

The module clones the `foundry_base` document into the world under a deterministic id derived from the vault + page path, then patches the `foundry:` overrides on top. Re-syncs update the same Actor / Item, so user edits to non-overridden fields (HP, conditions, equipped items) survive. Page deletion tears down the derived doc too, gated on a vault flag so docs you took over by hand are safe.

## Settings (world-scoped)

All state lives under a single `vaults` setting, an array of vault entries. The per-vault dialog edits one entry. Legacy single-vault keys (`url`, `token`, `rootFolder`, …) auto-migrate on first load.

Each vault entry tracks: `id`, `label`, `url`, `rootFolder`, `token`, `role`, `public`, `knownRoles`, `dmRole`, `lastManifest`, `lastImageManifest`, `pendingState`.

## Public API

```js
globalThis.Vaults = {
  sync(vaultId, { forceFull = false }),    // run a sync for one vault
  listVaults(),                            // [{ id, label, url, role, public }, …]
  getVault(id),                            // full vault entry
  openVaultsDialog(),                      // open Manage Vaults UI
};
```

## Limitations

- Page transclusion (`![[Page]]`) is dropped.
- Backlinks are not rendered (vaults-cli ships them as a sidebar; Foundry import currently ignores).
- One image cache per vault; large vaults can take a minute on first sync.

## License

MIT
