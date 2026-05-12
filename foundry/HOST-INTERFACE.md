# Host ↔ Importer interface

This file is the design surface between the Foundry **module** (the
"host") and the **importer** (a JS bundle fetched from each vault's
`${URL}/_foundry/importer.js`).

The module ships once and rarely changes. The importer ships per-vault,
versioned with the deploy, and runs against whatever module is installed.
This file is the **stable contract** that lets both move independently.

## Why this split exists

- The module wants to stay small: settings UI, vault registry, world-load
  hooks, handler-asset injection. None of that depends on per-vault
  importer logic.
- The importer wants to be vault-versioned: a vault deployed against
  importer v0.7 should sync with a v0.7 importer regardless of which
  module version the GM has installed.
- Result: the module loads the importer at sync time, hashes it for
  trust, hands it a stable `host` object, and the importer drives the
  actual sync against host primitives.

The host's job is **environment**, not **policy**: it gives the importer
state I/O, cache I/O, document classes, and UI primitives. It doesn't
decide what to do with them.

## Importer entry point

The fetched bundle is an ES module that exports:

```ts
// importer.js — what the wiki ships under /_foundry/importer.js

/**
 * Monotonically-increasing integer. Host checks this before calling
 * runSync. Bump when the contract gains a NEW host method the importer
 * relies on; do NOT bump for backward-compatible importer changes.
 *
 * If the importer's required version > the host's supported version,
 * the host refuses to run and tells the GM to update the module.
 * If the importer's version < the host's supported version, the host
 * shims missing fields and proceeds (host stays backwards-compat).
 */
export const REQUIRED_HOST_VERSION: number;

/**
 * Drive a sync of the given vault. The host has already validated the
 * URL, refreshed any token, and opened a notification slot. The
 * importer owns everything else: manifest diff, fetch batches, page
 * upserts, derived-doc instantiation, cache reconciliation.
 *
 * Throws on unrecoverable errors. The host translates the throw into
 * a user-facing notification.
 */
export async function runSync(
  host: Host,
  vault: VaultEntry,
  options: SyncOptions,
): Promise<SyncResult>;

/**
 * Delete every Foundry document + cached asset this importer's vault
 * created. Called by the host when the GM removes the vault from the
 * registry. Best-effort; host catches throws and notifies the GM.
 */
export async function runRemove(
  host: Host,
  vault: VaultEntry,
): Promise<void>;
```

The host loads the bundle via:

```js
const text = await (await fetch(`${vault.url}/_foundry/importer.js`)).text();
const blob = new Blob([text], { type: "application/javascript" });
const url = URL.createObjectURL(blob);
try {
  const mod = await import(url);
  // Verify mod.REQUIRED_HOST_VERSION ≤ HOST.API_VERSION before calling runSync.
} finally {
  URL.revokeObjectURL(url);
}
```

The text is SHA-256'd before blob creation; the hash is compared to the
trust-cache record for that vault. First sync: prompt the GM to accept
the hash. Hash mismatch on a subsequent sync: prompt with the
old/new hash both shown.

## Host API

```ts
interface Host {
  /** Bumped on breaking contract changes. Importer's REQUIRED_HOST_VERSION
   *  must be ≤ this. */
  readonly API_VERSION: number;

  /** Foundry document classes, passed through. Importer uses these
   *  instead of CONFIG / global lookups so the host can mock or shim
   *  in future. */
  readonly documents: {
    JournalEntry: typeof JournalEntry;
    Actor: typeof Actor;
    Item: typeof Item;
    Scene: typeof Scene;
    RollTable: typeof RollTable;
    Macro: typeof Macro;
    Cards: typeof Cards;
    Playlist: typeof Playlist;
    Folder: typeof Folder;
  };

  /** Active Foundry game instance, passed through. Importer reads
   *  game.world.id, game.system.id, game.i18n. Module-side state goes
   *  through getVaultState/setVaultState, not game.settings. */
  readonly game: Game;

  // ── Per-vault persisted state ──────────────────────────────────────
  //
  // The host owns where this lives (currently a single world setting
  // keyed by vault id; could change). The importer reads + writes
  // opaquely. Shape is the importer's concern; host doesn't introspect.

  getVaultState(vaultId: string): VaultState;
  setVaultState(vaultId: string, patch: Partial<VaultState>): Promise<void>;
  clearVaultState(vaultId: string): Promise<void>;

  // ── Per-vault local file cache ─────────────────────────────────────
  //
  // The host owns the cache root path (currently
  // `worlds/<id>/vaults-cache/<vault-id>/`). The importer uses
  // relative paths; the host turns them into Foundry-served URLs.

  /** Upload a binary into the vault's cache subtree. */
  uploadToCache(vaultId: string, relPath: string, blob: Blob): Promise<void>;

  /** Remove a single cached file. Best-effort; failures logged, not thrown. */
  deleteFromCache(vaultId: string, relPath: string): Promise<void>;

  /** Wipe the entire per-vault cache dir. Used on runRemove. */
  deleteVaultCache(vaultId: string): Promise<void>;

  /** Foundry-served URL Foundry can use as an <img src=> / scene texture /
   *  audio sound.path. Importer rewrites `@vault/PATH` to this. */
  localFileUrl(vaultId: string, relPath: string): string;

  // ── Authentication ────────────────────────────────────────────────
  //
  // Tokens live in vault state; the host's job is just the user-facing
  // flows (OAuth-style copy/paste from `${URL}/connect`). The importer
  // never directly prompts for credentials.

  /** Run the host's "you need to (re-)authenticate" flow. Returns the new
   *  token on success, null on cancel. The host writes the token to
   *  vault state itself; the importer just gets the resolved value. */
  refreshToken(vault: VaultEntry, reason: "expired" | "rejected" | "manual"): Promise<string | null>;

  // ── User-facing affordances ───────────────────────────────────────

  notify(level: "info" | "warn" | "error", message: string): void;

  /** Show a progress notification that the importer can update + close. */
  progress(opts: { title: string; total?: number }): ProgressHandle;

  /** A native-style confirm dialog. Used for destructive operations
   *  ("Sync removed N pages; delete the corresponding journal entries?"). */
  confirm(opts: { title: string; content: string; defaultYes?: boolean }): Promise<boolean>;

  /** i18n. Importer ships its own en.json bundled into the JS;
   *  passes keys through here so the host can warn on missing keys
   *  rather than rendering raw key strings. */
  localize(key: string, args?: Record<string, string | number>): string;
}

interface ProgressHandle {
  update(done: number, total?: number, label?: string): void;
  done(message?: string): void;
  fail(error: Error): void;
}
```

## Stable shapes

These types are the data the host and importer exchange. They're stable
because they're persisted (vault state) or passed across a serialization
boundary (sync options).

```ts
interface VaultEntry {
  id: string;             // 16-char [A-Za-z0-9]
  label: string;          // display name in the dialog
  url: string;            // base URL of the deploy, no trailing slash
  token: string;          // bearer; "" for public-tier syncs
  role: string;           // current role tier (matches token), or "" for public
  public: boolean;        // single-role deploy (no auth middleware)
  knownRoles: string[];   // from the manifest's auth.roles, lowest→highest
  dmRole: string;         // role cutoff for journal ownership; "" disabled
  rootFolder: string;     // Foundry-side root folder name
  importHandlerStyles: boolean;
  importHandlerScripts: boolean;
  handlerAssetPaths: { js: string; css: string };
}

interface VaultState {
  // Shape is opaque to the host. The current importer uses:
  //   { lastManifest: { [path]: hash }, lastImageManifest: { [path]: hash } }
  // Future importers MAY add fields; the host preserves unknown keys.
  [key: string]: unknown;
}

interface SyncOptions {
  forceFull?: boolean;            // skip the manifest diff, re-import everything
  signal?: AbortSignal;           // host may cancel mid-sync
}

interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  imageStats: { downloaded: number; removed: number; errors: number };
  instances: number;
}
```

## Versioning rules

- `Host.API_VERSION` is owned by the module. Bumped only on contract
  changes (new method, removed method, changed signature). Backward-
  compatible additions to importer-owned data shapes don't bump it.
- `importer.REQUIRED_HOST_VERSION` is the minimum host version the
  importer needs.
- On load:
  - `importer.REQUIRED_HOST_VERSION > host.API_VERSION` → host refuses
    to run; "Update the Wizzlethorpe Vaults module to sync this vault."
  - `importer.REQUIRED_HOST_VERSION ≤ host.API_VERSION` → host calls
    `runSync`; any newer host methods the importer doesn't know about
    just sit there unused.

## Trust model

- First time a host fetches an importer, it computes SHA-256 of the
  response text, displays the hash (or a short prefix) to the GM, and
  asks: "Trust the importer from `${url}` (`${hash.slice(0, 16)}…`)?"
  Result is stored in vault state.
- Subsequent fetches verify the hash. If it matches, sync proceeds
  silently. If it differs:
  - "Importer for `${url}` has changed since you last trusted it.
    `${oldHash}…` → `${newHash}…`. Accept / Cancel."
  - Accepting updates the trusted hash; canceling leaves the old hash
    in place and refuses to run.
- A `?--reset-trust` UI affordance lets the GM forcibly clear a stored
  trust hash (e.g., for testing or after they verified a hash out-of-
  band).

The host's own code is signed by Foundry's package directory — the
trust chain stops there. The importer trust hash protects against
**a wiki silently shipping different importer code than the GM expected**.

## Un-upgraded deploys

Vaults whose CLI hasn't been bumped to ship `_foundry/importer.js` will
404 on the fetch. The host refuses to sync them with a clear message:

> "This vault's deployed CLI doesn't ship an importer
> (`/_foundry/importer.js` 404'd). Update the CLI on the vault's
> author end and re-deploy, then try again."

We're still in 0.x; breaking change is fine.

## Migration

Existing module installs have vault config in `game.settings` under the
module ID, keyed under `vaults` (a JSON array of VaultEntry-shaped
objects) and `vaultManifests` (per-vault state). Both keep their current
shape — the migration is renaming the importer-side imports, not
changing the storage.

The one-time refactor:
1. Move `importer.mjs`, `sync.mjs`, `instance.mjs`, `links.mjs`,
   `media.mjs`, `ids.mjs`, `parser.mjs` from `foundry/scripts/` to a
   new `cli/src/importer/` source tree.
2. The CLI's build pipeline bundles those into a single ESM file at
   `_foundry/importer.js` in the deploy.
3. The Foundry module gains the host implementation + fetch/eval +
   trust-hash logic. It KEEPS the dialog UI, settings registration,
   vault registry, handler-asset import, world-ready hooks.

## Open design questions

- **Single ESM blob vs split files?** v1 is single bundle (one fetch,
  one hash). If the importer grows past ~500KB we can revisit.
- **Per-vault custom importer URL?** Not exposed in v1. The
  `${VAULT_URL}/_foundry/importer.js` convention is hardcoded. Easy to
  expose later as a per-vault setting.
- **dnd5e-specific `DESCRIPTION_FIELDS` table**: moves to the importer.
  A pf2e vault can ship a pf2e importer with its own table. The host
  has no per-system knowledge.
- **Locking against concurrent syncs**: today's module has no lock;
  two GMs running Sync on the same vault race on flag writes. The
  contract doesn't change this; could add a `host.acquireLock(vaultId)`
  in v2 if it becomes a problem.
