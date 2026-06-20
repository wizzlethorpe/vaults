// Pull vault assets (images + passthrough media) into Foundry's user-data
// directory so journal pages can reference them via plain local paths
// (worlds/<id>/...). The DM's bearer token authenticates the GETs; once
// the file is local, Foundry serves it like any other module asset.

import { CACHED_EXT_RE } from "./parser.mjs";
import { url as vaultUrl } from "./api.mjs";

// Where the cache lives inside the world data dir. No leading dot. Foundry's
// FilePicker validation hides dotfile paths from listings and may reject
// uploads underneath them depending on the version.
export const CACHE_DIR = "vaults-cache";

// Each batch is one HTTP request that returns base64 image bodies; we run
// BATCH_CONCURRENCY in parallel. A batch is capped by BOTH a max entry count
// and a cumulative byte budget — the byte budget is what keeps a handful of
// large map images from base64-inflating the response past the worker's
// memory limit (which would 500 the batch and surface as a CORS error).
const BATCH_SIZE = 25;
const BATCH_BYTE_BUDGET = 8 * 1024 * 1024;
const BATCH_CONCURRENCY = 4;

/** Should this manifest path be pulled into the per-vault cache? Filters out
 *  build-internal artifacts that match the cached-extension regex but aren't
 *  user assets:
 *    - paths starting with `_` (`_search-index.json`, future `_…`); the
 *      auth middleware also rejects these as unsafe and would 400 the whole
 *      batch if we sent them
 *    - per-page hover-preview JSON (`.preview.json`); the wiki uses these,
 *      but Foundry never references them, so caching them is wasted bytes
 */
function isCacheable(path) {
  if (!CACHED_EXT_RE.test(path)) return false;
  if (path.startsWith("_") || path.includes("/_")) return false;
  if (/\.preview\.json$/i.test(path)) return false;
  return true;
}

/** Local URL Foundry can serve for a file cached from the given vault. */
export function localFileUrl(vaultId, vaultPath) {
  const worldId = game.world?.id;
  if (!worldId) throw new Error("No active world; cache path unavailable.");
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
 * image whose hash differs from the cached image manifest, deletes orphans
 * where the Foundry API allows it, and persists the updated manifest into
 * the per-vault sync state. Returns counts for the user-facing
 * notification.
 *
 * @param host  The Host interface (see host.mjs). Used for the per-vault
 *              state I/O — everything else (FilePicker, game.world.id) is
 *              a Foundry global, called directly.
 */
export async function syncImages(host, vault, manifestFiles) {
  const remoteImages = new Map();
  for (const f of manifestFiles) {
    if (isCacheable(f.path)) remoteImages.set(f.path, f.hash);
  }

  const lastImageManifest = host.getVaultState(vault.id).lastImageManifest;
  const last = new Map(Object.entries(lastImageManifest || {}));

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

  // Batch by cumulative byte size, not just count. A fixed count of large
  // map images base64-inflates the JSON response past the worker's memory
  // limit, which 500s the whole batch — and an error response carries no CORS
  // header, so the browser reports it as a CORS failure. Sizes come from the
  // manifest. Each chunk stays under BATCH_BYTE_BUDGET and BATCH_SIZE entries;
  // a single file bigger than the budget still ships in a chunk of its own.
  const sizeOf = new Map();
  for (const f of manifestFiles) sizeOf.set(f.path, f.size ?? 0);

  const chunks = [];
  let chunk = [];
  let chunkBytes = 0;
  for (const path of toDownload) {
    const bytes = sizeOf.get(path) ?? 0;
    if (chunk.length > 0 && (chunk.length >= BATCH_SIZE || chunkBytes + bytes > BATCH_BYTE_BUDGET)) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(path);
    chunkBytes += bytes;
  }
  if (chunk.length > 0) chunks.push(chunk);

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
  await host.setVaultState(vault.id, { lastImageManifest: persisted });

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

  const res = await fetch(vaultUrl(vault, "/_batch-images"), {
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
      try {
        const res = await fetch(vaultUrl(vault, "/" + path));
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
    bmp: "image/bmp", heic: "image/heic", apng: "image/apng",
    ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
    flac: "audio/flac", opus: "audio/ogg", aac: "audio/aac",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg",
    pdf: "application/pdf", epub: "application/epub+zip", json: "application/json",
  })[ext] || "application/octet-stream";
}
