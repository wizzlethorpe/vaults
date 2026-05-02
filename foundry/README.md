# Vaults. Foundry VTT Module

Sync an Obsidian vault deployed via [vaults-cli](https://github.com/wizzlethorpe/vaults-cli) into Foundry VTT journals. Manifest-based incremental sync with role-based auth.

## Status

Early. v0.1.0; works for single-role and multi-role vaults; basics like wikilinks, image embeds, and folder hierarchy land in journals. Backlinks, callouts, and page transclusion render as plain markdown for now.

## How it works

1. You deploy a vault using `vaults-cli` (Cloudflare Pages).
2. In Foundry, install this module, click **Sync Vault** in the Journal sidebar.
3. Enter your vault URL → click **Connect** → vault redirects you to its `/connect` page → sign in (if multi-role) → click **Approve**.
4. Vault redirects back to Foundry with a 90-day bearer token.
5. Click **Sync Vault** again → module fetches `/_manifest.json`, diffs against the last seen state, fetches changed `.md` files, creates/updates journals.

The bearer token is the only credential; no copy-pasting tokens.

## Foundry compatibility

Verified on V14. Should work on V13.

## Module ID

`vaults`

## Settings

- **Vault URL** (`vaults.url`); base URL of your deployed vault, e.g. `https://my-vault.pages.dev`
- **Auth Token** (`vaults.token`); bearer token; set automatically by Connect
- **Root Folder** (`vaults.rootFolder`); top-level Foundry folder name (default: `Vault`)
- (Hidden) `vaults.lastManifest`; last-seen `{ path: hash }` map for incremental diff
- (Hidden) `vaults.role`; display label for the connected role
- (Hidden) `vaults.pendingState`. CSRF nonce for the connect round-trip

All settings are world-scoped (one vault per Foundry world).

## Public API

```js
globalThis.Vaults = {
  sync({ forceFull = false }),     // run a sync
  startConnect(vaultUrl),           // begin /connect flow (redirects)
  disconnect(),                      // clear token + lastManifest
};
```

## Limitations / TODO

- No backlinks rendering yet (vault-sync had this; not yet ported)
- Callouts render as raw markdown blockquotes (Foundry doesn't have native callout styling)
- Page transclusion (`![[Page]]`) is dropped silently
- No DM-callout filtering. Foundry shows whatever the role variant exposes; gating happens at the vault level
