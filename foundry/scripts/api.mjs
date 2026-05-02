// HTTP client for talking to a deployed vault. The bearer token is
// passed as a `?_token=` query param rather than an Authorization header
// so cross-origin GETs stay "simple" and don't trigger a CORS preflight
// per file — Cloudflare rate-limits OPTIONS bursts and a full sync is
// hundreds of unique URLs.

import { SETTINGS, get } from "./settings.mjs";

function url(base, path) {
  if (!base) throw new Error("Vault URL is not configured.");
  const u = new URL(path, base.endsWith("/") ? base : base + "/");
  const token = get(SETTINGS.token);
  if (token) u.searchParams.set("_token", token);
  return u.toString();
}

async function fetchJson(u) {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`GET ${u} → ${res.status}`);
  return res.json();
}

export async function fetchManifest() {
  const base = get(SETTINGS.url);
  return fetchJson(url(base, "/_manifest.json"));
}

const BATCH_SIZE = 100;
const BATCH_CONCURRENCY = 4;

/**
 * Bulk-fetch source paths via /_batch. Splits into chunks of BATCH_SIZE
 * (server cap is 200) and runs BATCH_CONCURRENCY in parallel. text/plain
 * + ?_token query keeps the POST CORS-simple so it doesn't trigger a
 * per-file preflight (which Cloudflare rate-limits on burst).
 */
export async function fetchSourceBatch(paths) {
  if (paths.length === 0) return new Map();
  const base = get(SETTINGS.url);
  const token = get(SETTINGS.token);
  const endpoint = new URL("/_batch", base.endsWith("/") ? base : base + "/");
  if (token) endpoint.searchParams.set("_token", token);

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
