// Fetch, hash-verify, and evaluate the wiki-shipped importer bundle.
// The module no longer imports sync/remove logic locally — each vault's
// deploy ships its own `_foundry/importer.js`, and the loader resolves
// that bundle into a live ES module the host then drives.
//
// Trust model: SHA-256 of the bundle text is compared with the vault
// entry's `trustedImporterHash`. First sync prompts the GM with a hash
// prefix; subsequent syncs are silent unless the hash changes, in which
// case both old and new hashes are shown. See foundry/HOST-INTERFACE.md.

import { updateVault } from "./vaults.mjs";
import { API_VERSION } from "./host.mjs";

// Session cache so back-to-back sync + remove (or repeated syncs at the
// same bundle version) don't refetch+reparse. Keyed by `${vaultId}:${hash}`
// so a bundle change invalidates automatically. Cleared on world reload.
const moduleCache = new Map();

/**
 * Resolve the wiki-shipped importer for `vault`. Returns the loaded ES
 * module, or `null` if the bundle can't be fetched, the GM declines to
 * trust it, or the importer requires a newer host than this module
 * supports. All failure modes notify the GM through `host.notify` so the
 * caller can return without an extra error UI.
 */
export async function loadImporter(host, vault) {
  if (!vault?.url) {
    host.notify("error", host.localize("VAULTS.Sync.NoUrl"));
    return null;
  }
  const base = vault.url.replace(/\/+$/, "");
  const url = `${base}/_foundry/importer.js`;

  let text;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (res.status === 404) {
      host.notify("error", host.localize("VAULTS.Importer.Missing", { url: base }));
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    host.notify("error", host.localize("VAULTS.Importer.FetchFailed", { message: err.message }));
    return null;
  }

  const hash = await sha256(text);
  const trusted = vault.trustedImporterHash || "";
  if (trusted !== hash) {
    const ok = await promptTrust(host, vault, trusted, hash);
    if (!ok) return null;
    await updateVault(vault.id, { trustedImporterHash: hash });
  }

  const cacheKey = `${vault.id}:${hash}`;
  const cached = moduleCache.get(cacheKey);
  if (cached) return cached;

  // Evaluate the bundle via a blob URL. Foundry runs in a single
  // window context, so `import()` of a blob: URL gives us a real ES
  // module with access to every Foundry global the importer needs.
  const blobUrl = URL.createObjectURL(new Blob([text], { type: "application/javascript" }));
  let mod;
  try {
    mod = await import(blobUrl);
  } catch (err) {
    host.notify("error", host.localize("VAULTS.Importer.EvalFailed", { message: err.message }));
    return null;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  const required = Number(mod.REQUIRED_HOST_VERSION) || 0;
  if (required > API_VERSION) {
    host.notify("error", host.localize("VAULTS.Importer.ModuleTooOld", { name: vault.label }));
    return null;
  }

  moduleCache.set(cacheKey, mod);
  return mod;
}

async function promptTrust(host, vault, oldHash, newHash) {
  const oldShort = oldHash ? `${oldHash.slice(0, 16)}…` : "";
  const newShort = `${newHash.slice(0, 16)}…`;
  const content = oldHash
    ? host.localize("VAULTS.Importer.HashChanged", {
        url: vault.url, oldHash: oldShort, newHash: newShort,
      })
    : host.localize("VAULTS.Importer.TrustPrompt", {
        url: vault.url, hash: newShort,
      });
  return host.confirm({
    title: host.localize("VAULTS.Importer.TrustTitle"),
    content,
    defaultYes: false,
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
