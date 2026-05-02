// Deterministic 16-char Foundry document IDs derived from stable keys.
// SHA-1 → first 16 hex chars (subset of Foundry's allowed [A-Za-z0-9]).
// 64-bit truncation collision risk is negligible. Each id is namespaced
// by vaultId so the same path under two vaults gets different journals.

const enc = new TextEncoder();

async function sha1Hex(s) {
  const buf = await crypto.subtle.digest("SHA-1", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function det(kind, key) {
  const hex = await sha1Hex(`vaults:${kind}:${key}`);
  return hex.slice(0, 16);
}

export const entryId = (vaultId, path) => det("entry", `${vaultId}:${path}`);
export const pageId = (vaultId, path) => det("page", `${vaultId}:${path}`);
export const folderId = (vaultId, path) => det("folder", `${vaultId}:${path}`);
