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

The bundle is evaluated inside Foundry's window context. That means
**Foundry globals like `JournalEntry`, `Actor`, `Scene`, `game`,
`fromUuid`, `FilePicker`, `Hooks`, `ui` are reachable directly** from
the importer — no need to plumb them through the host. The host's job
is the narrower set of primitives that aren't Foundry globals: things
the module owns (settings registrations, OAuth UI) or things worth
abstracting for testability / consistency (notifications, dialogs).

```ts
interface Host {
  /** Bumped on breaking contract changes. Importer's REQUIRED_HOST_VERSION
   *  must be ≤ this. */
  readonly API_VERSION: number;

  // ── Per-vault persisted state ──────────────────────────────────────
  //
  // The module registers a single `vaultManifests` world setting keyed
  // by vault id; the importer doesn't see that detail. Writes are
  // shallow patches over the current state object — pass `{ a: 1, b: 2 }`
  // to set those two keys, leaving every other key untouched.

  getVaultState(vaultId: string): VaultState;
  setVaultState(vaultId: string, patch: Partial<VaultState>): Promise<void>;
  clearVaultState(vaultId: string): Promise<void>;

  // ── Vault registry entry ──────────────────────────────────────────
  //
  // The registry itself is module-side. The importer reads to pick up
  // post-auth changes (token / role) and writes when probing the
  // manifest reveals new metadata.

  getVaultEntry(vaultId: string): VaultEntry | null;
  updateVaultEntry(vaultId: string, patch: Partial<VaultEntry>): Promise<void>;

  // ── User-facing affordances ───────────────────────────────────────
  //
  // Wrappers over `ui.notifications.*` and DialogV2. The importer
  // *could* call them directly, but going through the host means the
  // shape is consistent across importer versions and we have one place
  // to swap V13/V14 API differences.

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
```

### What's NOT on the host (and why)

Everything below stays as a direct Foundry-global reference in the
bundle. They're stable APIs Foundry exposes globally, and adding a host
layer over them would be performative.

| Used directly | Why not on the host |
|---|---|
| `JournalEntry`, `Actor`, `Item`, `Scene`, `RollTable`, `Macro`, `Cards`, `Playlist`, `Folder` | Foundry globals. Stable across V13/V14. |
| `game`, `ui`, `Hooks`, `CONFIG` | Same. |
| `fromUuid()` | Same. |
| `FilePicker.implementation.upload / createDirectory / deleteFile` | Same. The local-cache directory convention (`worlds/<id>/vaults-cache/<vault-id>/…`) is encoded as a bundle constant, since changing it would also break the journal HTML's image-src rewrites that already hardcode it. |
| `foundry.utils.getRoute(…)` | Same. |
| `game.settings.get("vaults", …)` | NOT used by the importer — that's host-only. The importer reaches vault state through `getVaultState` / `setVaultState`. |

```ts
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
  handlerAssetPaths: { foundryJs: string | null; foundryCss: string | null };
  trustedImporterHash: string;  // SHA-256 of the last GM-approved importer bundle.
}

interface VaultState {
  // Shape is opaque to the host. The current importer uses:
  //   { lastManifest: { [path]: hash }, lastImageManifest: { [path]: hash } }
  // Future importers MAY add fields; the host preserves unknown keys.
  [key: string]: unknown;
}

interface SyncOptions {
  forceFull?: boolean;            // skip the manifest diff, re-import everything
}

interface SyncResult {
  ok: boolean;
  refreshHandlerAssets: boolean;  // host re-applies CSS/JS post-sync when true.
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
