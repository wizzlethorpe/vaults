// HTTP client for talking to a deployed vault. All requests carry the bearer
// token if one is configured; the vault's auth middleware verifies the
// signature and serves the matching role variant.

import { MODULE_ID, SETTINGS, get } from "./settings.mjs";

function authHeaders() {
  const token = get(SETTINGS.token);
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

function url(base, path) {
  if (!base) throw new Error("Vault URL is not configured.");
  return new URL(path, base.endsWith("/") ? base : base + "/").toString();
}

async function fetchJson(u) {
  const res = await fetch(u, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${u} → ${res.status}`);
  return res.json();
}

async function fetchText(u) {
  const res = await fetch(u, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${u} → ${res.status}`);
  return res.text();
}

export async function fetchManifest() {
  const base = get(SETTINGS.url);
  return fetchJson(url(base, "/_manifest.json"));
}

export async function fetchSource(path) {
  const base = get(SETTINGS.url);
  return fetchText(url(base, path.replace(/^\//, "")));
}

/** Resolve an attachment path to an absolute URL the browser can load directly. */
export function attachmentUrl(path) {
  const base = get(SETTINGS.url);
  return url(base, path.replace(/^\//, ""));
}
