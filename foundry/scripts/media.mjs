// Pull vault images into Foundry's user-data directory so journal pages can
// reference them via plain local paths (worlds/<id>/...). The DM's bearer
// token is used to authenticate the GETs against the vault, but the token
// never ends up in journal HTML; once the file is local, Foundry serves
// it like any other module asset.

import { IMAGE_EXT_RE } from "./parser.mjs";
import { updateVault } from "./vaults.mjs";

// Where the cache lives inside the world data dir. No leading dot. Foundry's
// FilePicker validation hides dotfile paths from listings and may reject
// uploads underneath them depending on the version.
export const CACHE_DIR = "vaults-cache";

// Each batch is one HTTP request that returns up to BATCH_SIZE base64 image
// bodies; we run BATCH_CONCURRENCY in parallel. Sized so total in-flight
// payload stays under ~30MB.
const BATCH_SIZE = 25;
const BATCH_CONCURRENCY = 4;

/** Local URL Foundry can serve for an image cached from the given vault. */
export function localImageUrl(vaultId, vaultPath) {
  const worldId = game.world?.id;
  if (!worldId) throw new Error("No active world; image cache path unavailable.");
  const segs = vaultPath.split("/").map(encodeURIComponent).join("/");
  const relative = `worlds/${worldId}/${CACHE_DIR}/${vaultId}/${segs}`;
  return foundry.utils?.getRoute?.(relative) ?? `/${relative}`;
}

/** Where this vault's image cache lives on disk (relative to the data dir). */
export function vaultCacheDir(vaultId) {
  const worldId = game.world.id;
  return `worlds/${worldId}/${CACHE_DIR}/${vaultId}`;
}

/**
 * Reconcile a vault's local image cache with its manifest. Downloads any
 * image whose hash differs from `vault.lastImageManifest`, deletes orphans
 * where the Foundry API allows it, and persists the updated manifest back
 * onto the vault entry. Returns counts for the user-facing notification.
 */
export async function syncImages(vault, manifestFiles) {
  const remoteImages = new Map();
  for (const f of manifestFiles) {
    if (IMAGE_EXT_RE.test(f.path)) remoteImages.set(f.path, f.hash);
  }

  const last = new Map(Object.entries(vault.lastImageManifest || {}));

  const toDownload = [];
  for (const [path, hash] of remoteImages) {
    if (last.get(path) !== hash) toDownload.push(path);
  }
  const toDelete = [...last.keys()].filter((p) => !remoteImages.has(p));

  if (toDownload.length === 0 && toDelete.length === 0) return { downloaded: 0, removed: 0, errors: 0 };

  const baseDir = vaultCacheDir(vault.id);

  // Foundry's FilePicker.createDirectory creates exactly one level at a
  // time; if the parent doesn't exist the call ENOENTs out. We therefore
  // ask for every prefix in the chain — from the world root down to the
  // deepest per-image subdir. The world dir itself is guaranteed to exist
  // (game.world.id was just resolved), so we only walk path segments under
  // it. ensureDirs swallows "exists / already" errors, so re-asking for an
  // existing dir is harmless.
  const worldRoot = `worlds/${game.world.id}`;
  const dirsNeeded = new Set();
  const addChain = (fullPath) => {
    const sub = fullPath.startsWith(worldRoot + "/") ? fullPath.slice(worldRoot.length + 1) : "";
    if (!sub) return;
    let acc = worldRoot;
    for (const seg of sub.split("/")) {
      acc += "/" + seg;
      dirsNeeded.add(acc);
    }
  };
  addChain(baseDir);
  for (const p of toDownload) {
    const segs = p.split("/").slice(0, -1);
    if (segs.length > 0) addChain(`${baseDir}/${segs.join("/")}`);
  }
  await ensureDirs([...dirsNeeded]);

  const chunks = [];
  for (let i = 0; i < toDownload.length; i += BATCH_SIZE) {
    chunks.push(toDownload.slice(i, i + BATCH_SIZE));
  }

  let next = 0;
  const downloaded = [];
  const errors = [];
  const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, chunks.length) }, async () => {
    while (next < chunks.length) {
      const idx = next++;
      const chunk = chunks[idx];
      try {
        const blobs = await fetchImagesBatch(vault, chunk);
        // Foundry serialises file writes anyway; uploading sequentially within
        // a chunk avoids occasional collisions on directory creation.
        for (const path of chunk) {
          const blob = blobs.get(path);
          if (!blob) { errors.push({ path, err: new Error("missing in batch response") }); continue; }
          try {
            await uploadToWorld(baseDir, path, blob);
            downloaded.push(path);
          } catch (err) {
            errors.push({ path, err });
          }
        }
      } catch (err) {
        for (const path of chunk) errors.push({ path, err });
      }
    }
  });
  await Promise.all(workers);

  if (errors.length > 0) {
    console.warn(`Vaults | ${errors.length} image(s) failed to download:`, errors);
  }

  let removed = 0;
  for (const path of toDelete) {
    try {
      await deleteFromWorld(baseDir, path);
      removed++;
    } catch (err) {
      console.warn(`Vaults | could not remove orphan ${path}:`, err?.message || err);
    }
  }

  // Persist only the paths we actually have on disk; failures stay in the
  // diff so the next sync retries them.
  const persisted = {};
  for (const [path, hash] of remoteImages) {
    if (last.get(path) === hash) { persisted[path] = hash; continue; }
    if (downloaded.includes(path)) persisted[path] = hash;
  }
  await updateVault(vault.id, { lastImageManifest: persisted });

  return { downloaded: downloaded.length, removed, errors: errors.length };
}

/**
 * Delete a vault's entire image cache directory. Best-effort; depends on
 * the Foundry version exposing FilePicker.deleteFile. Returns true on
 * complete success, false if anything was left behind.
 */
export async function deleteVaultCache(vaultId) {
  const baseDir = vaultCacheDir(vaultId);
  const impl = fp();
  if (typeof impl.deleteFile !== "function") return false;
  try {
    // FilePicker doesn't expose recursive delete; walk and delete files
    // before removing dirs. Easier: just try the dir; some Foundry
    // versions accept a directory and recurse.
    await impl.deleteFile("data", baseDir);
    return true;
  } catch (err) {
    console.warn(`Vaults | could not remove cache dir ${baseDir}:`, err?.message || err);
    return false;
  }
}

// ── Vault → Foundry plumbing ──────────────────────────────────────────────

async function fetchImagesBatch(vault, paths) {
  // Public vaults have no Pages Functions, so /_batch-images doesn't exist.
  // Fall back to direct CDN GETs — slower per-image overhead but the only
  // option for static deploys.
  if (vault.public) return fetchImagesDirect(vault, paths);

  const u = new URL("/_batch-images", vault.url.endsWith("/") ? vault.url : vault.url + "/");
  if (vault.token) u.searchParams.set("_token", vault.token);

  const res = await fetch(u.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // CORS-simple, no preflight
    body: paths.join("\n"),
  });
  if (!res.ok) throw new Error(`POST /_batch-images → ${res.status}`);
  const data = await res.json();

  const out = new Map();
  for (const [path, b64] of Object.entries(data.files || {})) {
    out.set(path, base64ToBlob(b64, guessMime(path)));
  }
  return out;
}

async function fetchImagesDirect(vault, paths) {
  const baseHasTrailingSlash = vault.url.endsWith("/");
  const out = new Map();
  // Match BATCH_CONCURRENCY's polite-but-quick profile; images are larger
  // than text bodies so we don't want to fan out as wide as the source-text
  // direct fallback.
  const PARALLEL = 6;
  let next = 0;
  const workers = Array.from({ length: Math.min(PARALLEL, paths.length) }, async () => {
    while (next < paths.length) {
      const idx = next++;
      const path = paths[idx];
      const u = new URL("/" + path, baseHasTrailingSlash ? vault.url : vault.url + "/");
      try {
        const res = await fetch(u.toString());
        if (!res.ok) continue;
        const blob = await res.blob();
        // Some Cloudflare deploys serve images with a generic content-type;
        // override with the extension-derived mime so Foundry's FilePicker
        // upload accepts it.
        const typed = blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: guessMime(path) });
        out.set(path, typed);
      } catch (err) {
        console.warn(`Vaults | GET ${path} failed:`, err);
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function base64ToBlob(b64, type) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function fp() {
  return foundry.applications?.apps?.FilePicker?.implementation
    ?? FilePicker.implementation
    ?? FilePicker;
}

async function uploadToWorld(baseDir, path, blob) {
  const segs = path.split("/");
  const filename = segs.pop();
  const dir = segs.length > 0 ? `${baseDir}/${segs.join("/")}` : baseDir;
  const file = new File([blob], filename, { type: blob.type || guessMime(filename) });
  const result = await fp().upload("data", dir, file, {}, { notify: false });
  if (result === false || result?.status === "error") {
    throw new Error(`upload failed: ${result?.message || "unknown"} (path=${dir}/${filename})`);
  }
}

async function ensureDirs(paths) {
  paths.sort((a, b) => a.length - b.length);
  for (const p of paths) {
    try { await fp().createDirectory("data", p, {}); }
    catch (err) {
      const msg = String(err?.message || err);
      if (!/exists|already/i.test(msg)) throw err;
    }
  }
}

async function deleteFromWorld(baseDir, path) {
  const full = `${baseDir}/${path}`;
  const impl = fp();
  if (typeof impl.deleteFile === "function") {
    await impl.deleteFile("data", full);
    return;
  }
  throw new Error("FilePicker.deleteFile is not available in this Foundry version.");
}

function guessMime(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ({
    webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", svg: "image/svg+xml", avif: "image/avif", tiff: "image/tiff",
  })[ext] || "application/octet-stream";
}
