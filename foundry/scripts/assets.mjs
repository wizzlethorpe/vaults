// Bring vault files into the world so Foundry can serve them.
//
// A scene background or token image has to be a path Foundry can open, which
// means the bytes have to be on the reader's own server. They land under
// `worlds/<world>/vaults-cache/<vault>/`, keyed by the variant they came from
// so a GM's copy of a file and a player's copy never collide.

import { url as vaultUrl } from "./api.mjs";

export const CACHE_DIR = "vaults-cache";

// What this world already downloaded, kept beside the files it describes so
// clearing the cache directory clears the record with it.
const RECORD = "placed.json";

// Enough large maps in one base64 batch inflates past the worker's memory
// limit, a failure that arrives as a CORS error rather than a 500.
const BATCH_SIZE = 10;

const MIME = {
  webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", avif: "image/avif",
  ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
  webm: "video/webm", mp4: "video/mp4",
  pdf: "application/pdf", json: "application/json", txt: "text/plain",
};

const mimeOf = (p) => MIME[p.split(".").pop()?.toLowerCase()] ?? "application/octet-stream";

function fp() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker.implementation ?? FilePicker;
}

/** Where this vault's files live, relative to the user data dir. */
export function cacheDir(vaultId) {
  return `worlds/${game.world.id}/${CACHE_DIR}/${vaultId}`;
}

/** The path Foundry serves a cached file from. */
export function localPath(vaultId, variant, path) {
  const segs = `${variant}/${path}`.split("/").map(encodeURIComponent).join("/");
  const relative = `${cacheDir(vaultId)}/${segs}`;
  return foundry.utils?.getRoute?.(relative) ?? `/${relative}`;
}

/** `"<variant>/<path>"` to the content hash it was downloaded at. */
async function readPlaced(vaultId) {
  const route = foundry.utils?.getRoute?.(`${cacheDir(vaultId)}/${RECORD}`) ?? `/${cacheDir(vaultId)}/${RECORD}`;
  try {
    const res = await fetch(`${route}?v=${Date.now()}`);
    if (!res.ok) return {};
    const data = await res.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    // No record is the same as an empty one: everything gets fetched.
    return {};
  }
}

async function writePlaced(vaultId, record) {
  const file = new File([JSON.stringify(record)], RECORD, { type: "application/json" });
  try { await fp().upload("data", cacheDir(vaultId), file, {}, { notify: false }); }
  catch (err) { console.warn("Vaults | could not record what was cached:", err); }
}

/**
 * Forget what was cached, so everything downloads again over the top.
 *
 * The bytes stay: core's FilePicker uploads and makes directories and has no
 * remove. Re-fetching overwrites them, which is what the reader is asking for.
 */
export async function forgetPlaced(vaultId) {
  await writePlaced(vaultId, {});
}

function base64ToBlob(b64, type) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Fetch one variant's files.
 *
 * A gated deploy answers `/_batch-images`; a single-role one has no Pages
 * Functions at all and its single variant is the site root, so its files come
 * from ordinary GETs.
 */
async function fetchFiles(vault, variant, paths) {
  const out = new Map();
  if (!vault.gated) {
    await Promise.all(paths.map(async (path) => {
      try {
        const res = await fetch(vaultUrl(vault, "/" + path));
        if (!res.ok) return;
        const blob = await res.blob();
        // Some deploys serve a generic content-type, which the upload rejects.
        out.set(path, blob.type && blob.type !== "application/octet-stream"
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: mimeOf(path) }));
      } catch (err) {
        console.warn(`Vaults | GET ${path} failed:`, err);
      }
    }));
    return out;
  }

  const endpoint = new URL(vaultUrl(vault, "/_batch-images"));
  endpoint.searchParams.set("role", variant);
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const chunk = paths.slice(i, i + BATCH_SIZE);
    const res = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // CORS-simple, no preflight
      body: chunk.join("\n"),
    });
    if (!res.ok) throw new Error(`POST /_batch-images (${variant}) → ${res.status}`);
    const data = await res.json();
    for (const [path, b64] of Object.entries(data.files || {})) {
      out.set(path, base64ToBlob(b64, mimeOf(path)));
    }
  }
  return out;
}

async function ensureDirs(dirs) {
  // Foundry creates one level at a time, so parents have to go first.
  for (const dir of [...dirs].sort((a, b) => a.length - b.length)) {
    try { await fp().createDirectory("data", dir, {}); }
    catch (err) {
      if (!/exists|already/i.test(String(err?.message || err))) throw err;
    }
  }
}

/**
 * Download the given references and place them in the world.
 *
 * @param vault    `{ url, token, gated }`
 * @param vaultId  names this vault's directory in the cache
 * @param wanted   variant → Set of paths, from `byVariant`
 * @param onFile  called with each file's name as it lands, for progress
 * @param assets  "variant/path" → content hash, from the vault's grafts.json.
 *   A file already here at the same hash is left alone; a path the vault gave
 *   no hash for is always fetched, since nothing distinguishes a stale copy
 *   from a current one.
 * @returns `{ placed, failed }` — placed maps "variant/path" to a local path,
 *   failed is a list of `{ id, reason }` in the shape graft reports.
 */
export async function placeAssets(vault, vaultId, wanted, onFile, assets = {}) {
  const placed = new Map();
  const failed = [];
  const record = await readPlaced(vaultId);
  let recorded = false;

  for (const [variant, paths] of wanted) {
    const list = [];
    for (const path of paths) {
      const key = `${variant}/${path}`;
      if (assets[key] && record[key] === assets[key]) {
        placed.set(key, localPath(vaultId, variant, path));
        onFile?.(path.split("/").pop());
      } else {
        list.push(path);
      }
    }
    if (list.length === 0) continue;
    let files;
    try {
      files = await fetchFiles(vault, variant, list);
    } catch (err) {
      // One variant failing is not the others failing. Say which, because
      // "an asset did not load" is unactionable and "the DM variant returned
      // 403" names both the cause and the fix.
      failed.push({ id: variant, reason: err.message });
      continue;
    }

    const base = cacheDir(vaultId);
    const dirs = new Set([base, `${base}/${variant}`]);
    for (const path of files.keys()) {
      const segs = `${variant}/${path}`.split("/");
      segs.pop();
      for (let i = 1; i <= segs.length; i++) dirs.add(`${base}/${segs.slice(0, i).join("/")}`);
    }
    await ensureDirs(dirs);

    for (const path of list) {
      const blob = files.get(path);
      if (!blob) {
        failed.push({ id: `${variant}/${path}`, reason: "not served by the vault" });
        continue;
      }
      const segs = `${variant}/${path}`.split("/");
      const name = segs.pop();
      try {
        const file = new File([blob], name, { type: blob.type || mimeOf(name) });
        const result = await fp().upload("data", `${base}/${segs.join("/")}`, file, {}, { notify: false });
        if (result === false || result?.status === "error") {
          throw new Error(result?.message || "upload rejected");
        }
        placed.set(`${variant}/${path}`, localPath(vaultId, variant, path));
        if (assets[`${variant}/${path}`]) {
          record[`${variant}/${path}`] = assets[`${variant}/${path}`];
          recorded = true;
        }
      } catch (err) {
        failed.push({ id: `${variant}/${path}`, reason: err.message });
      }
      onFile?.(name);
    }
  }
  if (recorded) await writePlaced(vaultId, record);
  return { placed, failed };
}
