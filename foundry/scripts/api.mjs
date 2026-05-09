// HTTP client for talking to a deployed vault. The bearer token rides as
// a `?_token=` query param (not an Authorization header) so cross-origin
// GETs stay CORS-simple; no preflight per file.
//
// Public (single-role) vaults don't ship Pages Functions, so /_batch and
// /_connect don't exist. Falls back to direct CDN GETs in that case;
// chunked + parallel-bounded to stay polite with rate limits.

function url(vault, path) {
  if (!vault?.url) throw new Error("Vault URL is not configured.");
  const u = new URL(path, vault.url.endsWith("/") ? vault.url : vault.url + "/");
  if (vault.token) u.searchParams.set("_token", vault.token);
  return u.toString();
}

async function fetchJson(u) {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`GET ${u} → ${res.status}`);
  return res.json();
}

export async function fetchManifest(vault) {
  return fetchJson(url(vault, "/_manifest.json"));
}

const BATCH_SIZE = 100;
const BATCH_CONCURRENCY = 4;
// Per-file concurrency for the public-vault direct-GET fallback. Higher than
// BATCH_CONCURRENCY because each request is much smaller; lower than what the
// origin server would tolerate so we stay under Cloudflare's per-IP burst cap.
const DIRECT_CONCURRENCY = 8;

/**
 * Bulk-fetch source paths. For protected vaults this hits /_batch (one POST
 * per chunk); for public vaults it falls back to direct GETs of each file
 * (single-role builds don't deploy /_batch). Returns the same Map shape
 * either way so callers don't care which path ran.
 */
export async function fetchSourceBatch(vault, paths) {
  if (paths.length === 0) return new Map();
  if (vault.public) return fetchSourceDirect(vault, paths);

  const endpoint = url(vault, "/_batch");
  const chunks = [];
  for (let i = 0; i < paths.length; i += BATCH_SIZE) chunks.push(paths.slice(i, i + BATCH_SIZE));

  const out = new Map();
  let next = 0;
  const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, chunks.length) }, async () => {
    while (next < chunks.length) {
      const idx = next++;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: chunks[idx].join("\n"),
      });
      if (!res.ok) throw new Error(`POST /_batch → ${res.status}`);
      const data = await res.json();
      if (data.files) {
        for (const [p, content] of Object.entries(data.files)) out.set(p, content);
      }
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchSourceDirect(vault, paths) {
  const out = new Map();
  let next = 0;
  const workers = Array.from({ length: Math.min(DIRECT_CONCURRENCY, paths.length) }, async () => {
    while (next < paths.length) {
      const idx = next++;
      const path = paths[idx];
      const u = url(vault, "/" + path);
      try {
        const res = await fetch(u);
        if (!res.ok) {
          if (res.status !== 404) console.warn(`Vaults | GET ${path} → ${res.status}`);
          continue;
        }
        out.set(path, await res.text());
      } catch (err) {
        console.warn(`Vaults | GET ${path} failed:`, err);
      }
    }
  });
  await Promise.all(workers);
  return out;
}
