# Wizzlethorpe Vaults: Foundry VTT Module

Sync an Obsidian vault deployed via [vaults-cli](https://github.com/wizzlethorpe/vaults) into Foundry VTT as journal entries (and optionally Actors / Items). Manifest-based incremental sync, role-based auth, multi-vault support, local image cache.

## Status

v0.7.0. Public and multi-role vaults sync end to end. Wikilinks, page transclusions, image embeds, callouts, Bases (cards / table / list), and folder hierarchy all import.

## How it works

1. Deploy a vault with `vaults push` (Cloudflare Pages).
2. In Foundry, install this module and click **Sync Vault** in the Journal sidebar to open the Vaults dialog.
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
- **Media.** Embedded images, plus passthrough audio / video / PDFs / JSON, are downloaded to a per-vault local cache; rewritten `<img src>` points at the cached file so journals work offline. Inside `foundry.data`, the `@vault/PATH` prefix on any string field gets rewritten to the cached URL so Scene textures / Playlist sounds reference vault-shipped media without hardcoding the deploy URL.
- **Bases.** Cards, table, and list views render natively. Card hrefs become `data-uuid` content-links, so clicking a card navigates to the linked journal.
- **Callouts.** Standard callouts render with the vault's CSS. Role-gated callouts inside player-visible pages are wrapped in `<section class="secret">`, so non-GM viewers don't see them even when they can see the surrounding article.

## Multi-vault

You can connect any number of vaults to a single Foundry world. Each vault gets its own row in the Vaults dialog, its own root folder, its own image cache, and its own auth state. Removing a vault tears down its journals, derived Actors / Items, and cached images.

## Per-vault permission gate (`dmRole`)

Each vault has a `dmRole` setting that controls journal ownership on import:

- Pages whose role rank is **below** `dmRole` import as **Observer** ownership (visible to all players).
- Pages at-or-above `dmRole` stay **GM-only**.

Combined with the `<section class="secret">` wrapping, this lets you include a public-facing journal with DM secrets inline; players see the article, GMs see everything.

Default is empty (everything imports GM-only).

## Auto Actors / Items / Scenes / etc.

Pages with a `foundry:` block spawn a linked Foundry document alongside the journal:

```yaml
---
foundry:
  base: Compendium.dnd5e.monsters.Actor.bandit  # UUID, OR Type[:subtype] for blank doc
  data:                                         # deep-merge overlay
    system:
      attributes:
        hp:
          value: 22
  embed: false                                  # optional, default true
---
```

The `base` field accepts either a compendium UUID (clones the template) or `Type[:subtype]` like `Actor:npc` / `Item:weapon` / `Scene` (creates a blank document). Supported blank types: Actor, Item, Scene, JournalEntry, RollTable, Macro, Cards, Playlist. The module instantiates the doc under a deterministic id derived from the vault + page path, deep-merges `foundry.data_json` (if present, a JSON file shipped with the vault) onto the base, then layers `foundry.data` on top. Re-syncs update the same doc, so user edits to non-overridden fields (HP, conditions, equipped items) survive. Page deletion tears down the derived doc, gated on a vault flag so docs you took over by hand are safe.

Instantiated docs land in a per-doctype folder named after the vault (Actors → "Southaven", Items → "Southaven", etc.), so multi-vault worlds keep their sidebars tidy. The folder is recreated on demand if you delete it, and the doc's `folder` is reasserted on every sync (move it elsewhere if you want it elsewhere; the next sync moves it back).

`foundry.embed: false` skips the auto-embed of the page article into the doc's description field — useful for stats-only pages or DM-private notes where embedding would leak content into the actor sheet.

`foundry.id` (16 chars `[A-Za-z0-9]`) pins both the page's `JournalEntryPage` and its instantiated doc (when `foundry.base` is set) to an explicit Foundry id instead of the SHA1-derived default. Lets external Foundry code (hotbar macros, scene flags, other modules) reference the doc by a known id without hardcoding the SHA1. Cross-page wikilinks `[[Other Page]]` resolve through the override automatically. The folder-shared parent `JournalEntry` id is *not* overridable (siblings would conflict). Changing `foundry.id` between syncs leaves the previously-created doc orphaned in the world; the module won't auto-delete it, on the same "manually-edited docs are safe" principle that protects user edits.

## Handler-asset import (CSS / JS from the vault into Foundry)

If a vault includes custom handlers with browser-side assets that opt into Foundry import (`assets.targets.foundry.{styles,scripts}` on the handler), GMs can pull those assets into the world via the per-vault settings dialog ("Import handler stylesheets" / "Import handler scripts"). Both default off. Enabling JS import shows a confirmation dialog explaining that the script will run with full access to game state; turning either on persists the consent, but JS import additionally re-prompts once per session before running freshly-fetched code.

The import bundles are fetched per-variant (the auth middleware role-gates them), so a `dm`-tier handler isn't accessible to a public visitor.

## Settings (world-scoped)

All state lives under two settings: `vaults` (lightweight array of entries, edited by the per-vault dialog) and `vaultManifests` (object keyed by vault id holding `lastManifest` and `lastImageManifest`). They're split so per-vault config patches don't re-serialize every other vault's full file list. Legacy single-vault keys (`url`, `token`, `rootFolder`, …) and inline manifests auto-migrate on first load.

Each vault entry tracks: `id`, `label`, `url`, `rootFolder`, `token`, `role`, `public`, `knownRoles`, `dmRole`, `importHandlerStyles`, `importHandlerScripts`, `handlerAssetPaths`.

## Public API

```js
globalThis.Vaults = {
  sync(vaultId, { forceFull = false }),    // run a sync for one vault
  listVaults(),                            // [{ id, label, url, role, public }, …]
  getVault(id),                            // full vault entry
  openVaultsDialog(),                      // open the Vaults dialog
};
```

## Limitations

- Backlinks are not rendered (vaults-cli includes them as a sidebar; Foundry import currently ignores).
- One image cache per vault; large vaults can take a minute on first sync.
- **Secret blocks leak through `@Embed` on derived Items / Actors.** When a page has a `foundry.base`, the cloned Item / Actor's description embeds the page via `@Embed[JournalEntry.…]`. Foundry's text enricher decides whether to hide `<section class="secret">` content based on the *parent* document's permissions, not the embedded page's, so a player who owns the Item sheet sees secret blocks even when the underlying journal page would have hidden them. The journal page itself still hides them correctly. This is a Foundry-side limitation of the `@Embed` enricher; keep DM-only material on dedicated dm-role pages, or set `foundry.embed: false` on the public page.

## License

MIT
