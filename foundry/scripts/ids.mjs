// Deterministic 16-char Foundry document IDs derived from stable keys.
// SHA-1 → first 16 hex chars (subset of Foundry's allowed [A-Za-z0-9]).
// 64-bit truncation collision risk is negligible. Each id is namespaced
// by vaultId so the same path under two vaults gets different journals.

import { hexDigest } from "./util.mjs";

async function det(kind, key) {
  const hex = await hexDigest("SHA-1", `vaults:${kind}:${key}`);
  return hex.slice(0, 16);
}

/** Strip the file basename from a vault path. Root-level files return "". */
export function folderOfPath(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

// JournalEntry ids are now folder-keyed: every page in the same directory
// shares one entry, so the entry id is derived from `folderOfPath(path)`.
// Page ids stay file-keyed (one page per file). Folder ids are file/dir keys
// for the Foundry Folder hierarchy and are unrelated to JournalEntry ids.
export const entryId = (vaultId, path) => det("entry", `${vaultId}:${folderOfPath(path)}`);
export const pageId = (vaultId, path) => det("page", `${vaultId}:${path}`);
export const folderId = (vaultId, path) => det("folder", `${vaultId}:${path}`);
// Deterministic id for the world-level Actor/Item that a page with foundry.base
// instantiates. One id space across both collections is fine (Foundry keys
// each document type's collection separately, so an Actor and an Item could
// even share an id without colliding).
export const instanceId = (vaultId, path) => det("instance", `${vaultId}:${path}`);

// Deterministic id for an embedded sub-document (a wall, a tile, a sound,
// a card, …) under a parent doc instantiated by the vaults importer. The
// pointer is a JSON-pointer-shaped string into foundry.data identifying the
// item's position (e.g. "/walls/3" or "/cards/0/faces/1"). Stable across
// re-syncs as long as the array order stays the same — reordering shifts
// ids, which is acceptable since reordering is an authorial action.
export const subdocId = (vaultId, path, pointer) => det("subdoc", `${vaultId}:${path}:${pointer}`);
