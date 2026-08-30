// HTTP client for talking to a deployed vault. The bearer token rides as
// a `?_token=` query param (not an Authorization header) so cross-origin
// GETs stay CORS-simple; no preflight per file.
//
// A single-role vault ships no Pages Functions, so /_batch does not exist.
// Falls back to direct GETs in that case; chunked and parallel-bounded to stay
// polite with rate limits.

/**
 * Build a fully-qualified URL for a vault endpoint, appending the bearer
 * token as `?_token=` when one is set. The one place that knows the
 * trailing-slash and token rules.
 */
export function url(vault, path) {
  if (!vault?.url) throw new Error("Vault URL is not configured.");
  const u = new URL(path, vault.url.endsWith("/") ? vault.url : vault.url + "/");
  if (vault.token) u.searchParams.set("_token", vault.token);
  return u.toString();
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
/**
 * The /_batch URL for one role's rendering.
 *
 * Exported so this is testable, because it was wrong in a way nothing caught:
 * built by appending `?role=…` to url(), which has already put the bearer in
 * the query. The second "?" folded the role into the *token's* value, so the
 * token failed to verify and the request quietly dropped to the lowest role,
 * while `role` was never a parameter at all. Every page above that tier came
 * back missing, with no 403 and no error — the guard never saw a role to
 * reject, and a missing file is not an error to the batch endpoint.
 */
export function batchEndpoint(vault, role) {
  const endpoint = new URL(url(vault, "/_batch"));
  if (role) endpoint.searchParams.set("role", role);
  return endpoint;
}

export async function fetchSourceBatch(vault, paths, role) {
  if (paths.length === 0) return new Map();
  if (!vault.gated) return fetchSourceDirect(vault, paths);

  // `role` asks for the variant matching the page's *own* role, not the
  // reader's; see batchEndpoint for why it must be a real search param.
  const endpoint = batchEndpoint(vault, role);
  const chunks = [];
  for (let i = 0; i < paths.length; i += BATCH_SIZE) chunks.push(paths.slice(i, i + BATCH_SIZE));

  const out = new Map();
  let next = 0;
  const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, chunks.length) }, async () => {
    while (next < chunks.length) {
      const idx = next++;
      const res = await fetch(endpoint.toString(), {
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
