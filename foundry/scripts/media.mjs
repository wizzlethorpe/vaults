// Pull vault images into Foundry's user-data directory so journal pages can
// reference them via plain local paths (worlds/<id>/...). The DM's bearer
// token is used to authenticate the GETs against the vault, but the token
// never ends up in journal HTML — once the file is local, Foundry serves
// it like any other module asset.

import { SETTINGS, get, set } from "./settings.mjs";
import { IMAGE_EXT_RE } from "./parser.mjs";

// Where the cache lives inside the world data dir. No leading dot — Foundry's
// FilePicker validation hides dotfile paths from listings and may reject
// uploads underneath them depending on the version.
export const CACHE_DIR = "vaults-cache";

// Binary batch settings. Each batch is one HTTP request that returns up to
// BATCH_SIZE base64-encoded image bodies; we run BATCH_CONCURRENCY of those
// in parallel. Sized so total in-flight payload stays under ~30MB and we
// don't hit Cloudflare's per-IP burst limits.
const BATCH_SIZE = 25;
const BATCH_CONCURRENCY = 4;

/** Local URL Foundry can serve for an image cached from the vault. */
export function localImageUrl(vaultPath) {
  const worldId = game.world?.id;
  if (!worldId) throw new Error("No active world; image cache path unavailable.");
  const segs = vaultPath.split("/").map(encodeURIComponent).join("/");
  const relative = `worlds/${worldId}/${CACHE_DIR}/${segs}`;
  // Use foundry.utils.getRoute so the URL respects Foundry's routePrefix
  // (when a server is hosted under e.g. /foundry/...). Falls back to a
  // leading-slash absolute path so the browser doesn't resolve it against
  // whatever document URL the journal renders inside.
  return foundry.utils?.getRoute?.(relative) ?? `/${relative}`;
}

/**
 * Reconcile the local image cache with the manifest. Downloads any image
 * whose hash differs from `lastImageManifest`, deletes orphans where the
 * Foundry API allows it. Returns counts for the user-facing notification.
 */
export async function syncImages(manifestFiles) {
  const remoteImages = new Map();
  for (const f of manifestFiles) {
    if (IMAGE_EXT_RE.test(f.path)) remoteImages.set(f.path, f.hash);
  }

  const last = new Map(Object.entries(get(SETTINGS.lastImageManifest) || {}));

  const toDownload = [];
  for (const [path, hash] of remoteImages) {
    if (last.get(path) !== hash) toDownload.push(path);
  }
  const toDelete = [...last.keys()].filter((p) => !remoteImages.has(p));

  if (toDownload.length === 0 && toDelete.length === 0) return { downloaded: 0, removed: 0 };

  const worldId = game.world.id;
  const baseDir = `worlds/${worldId}/${CACHE_DIR}`;

  // Pre-create every directory we're about to write into. FilePicker.upload
  // doesn't auto-create, so missing parents → 404 errors mid-batch.
  const dirsNeeded = new Set([baseDir]);
  for (const p of toDownload) {
    const segs = p.split("/").slice(0, -1);
    for (let i = 0; i < segs.length; i++) {
      dirsNeeded.add(`${baseDir}/${segs.slice(0, i + 1).join("/")}`);
    }
  }
  await ensureDirs([...dirsNeeded]);

  // Slice paths into batches. Each batch is one HTTP request that returns
  // base64 bodies for up to BATCH_SIZE images, so 300 images is ~12 calls
  // instead of 300 — well under Cloudflare's rate limits.
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
        const blobs = await fetchImagesBatch(chunk);
        // Upload to Foundry sequentially within a chunk — the Foundry server
        // serialises file writes anyway, and parallel uploads sometimes
        // collide on directory creation.
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
      // Foundry's file-delete API isn't available in every version; orphans
      // are harmless but accumulate. Log once per failure.
      console.warn(`Vaults | could not remove orphan ${path}:`, err?.message || err);
    }
  }

  // Persist the new manifest only with paths we actually have on disk —
  // failures stay in the diff so the next sync retries them.
  const persisted = {};
  for (const [path, hash] of remoteImages) {
    if (last.get(path) === hash) { persisted[path] = hash; continue; }
    if (downloaded.includes(path)) persisted[path] = hash;
  }
  await set(SETTINGS.lastImageManifest, persisted);

  return { downloaded: downloaded.length, removed, errors: errors.length };
}

// ── Vault → Foundry plumbing ──────────────────────────────────────────────

async function fetchImagesBatch(paths) {
  const base = get(SETTINGS.url);
  const token = get(SETTINGS.token);
  const endpoint = (() => {
    const u = new URL("/_batch-images", base.endsWith("/") ? base : base + "/");
    if (token) u.searchParams.set("_token", token);
    return u.toString();
  })();

  const res = await fetch(endpoint, {
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

function base64ToBlob(b64, type) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Resolve whichever FilePicker class this Foundry version exposes. V13+
// surfaces FilePicker.implementation; older versions just use FilePicker.
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
  // FilePicker.upload returns false on failure rather than throwing, so we
  // have to inspect the result. notify:false suppresses one toast per file.
  const result = await fp().upload("data", dir, file, {}, { notify: false });
  if (result === false || result?.status === "error") {
    throw new Error(`upload failed: ${result?.message || "unknown"} (path=${dir}/${filename})`);
  }
}

async function ensureDirs(paths) {
  // FilePicker.createDirectory creates a single level only and throws if
  // the directory already exists. Sort so parents come first, swallow
  // EEXIST-style errors. Ordering by length is a cheap topo sort here.
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
