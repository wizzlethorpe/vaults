// Top-level sync orchestrator.
//
// Pull /_manifest.json, diff against last-known hashes (stored in world
// settings), upsert/delete journals for the difference. Hashes come from
// the manifest itself (MD5 of the served file content), so the diff is just
// a key-by-key compare of two flat objects.

import { SETTINGS, get, set } from "./settings.mjs";
import { fetchManifest, fetchSource } from "./api.mjs";
import { upsertFile, deleteFile } from "./importer.mjs";
import { buildPathIndex } from "./links.mjs";

export async function sync({ forceFull = false } = {}) {
  const url = get(SETTINGS.url);
  if (!url) {
    ui.notifications.error(game.i18n.localize("VAULTS.Sync.NoUrl"));
    return;
  }

  const start = Date.now();
  ui.notifications.info(game.i18n.localize("VAULTS.Sync.Starting"));

  const manifest = await fetchManifest();
  const remote = new Map(manifest.files.map((f) => [f.path, f.hash]));
  const local = forceFull ? new Map() : new Map(Object.entries(get(SETTINGS.lastManifest) || {}));

  const mdPaths = manifest.files.filter((f) => f.path.endsWith(".md")).map((f) => f.path);
  const pathIndex = buildPathIndex(manifest.files);

  // Diff: any md file whose hash differs (or is new) needs an upsert; any md
  // file in local but not remote needs a delete.
  const toUpsert = mdPaths.filter((p) => remote.get(p) !== local.get(p));
  const toDelete = [...local.keys()].filter((p) => p.endsWith(".md") && !remote.has(p));

  if (toUpsert.length === 0 && toDelete.length === 0) {
    ui.notifications.info(game.i18n.localize("VAULTS.Sync.NothingToDo"));
    return;
  }

  ui.notifications.info(
    forceFull
      ? game.i18n.format("VAULTS.Sync.Initial", { count: toUpsert.length })
      : game.i18n.format("VAULTS.Sync.Incremental", {
          add: toUpsert.length, mod: 0, del: toDelete.length,
        }),
  );

  let added = 0, modified = 0;
  for (const path of toUpsert) {
    try {
      const source = await fetchSource(path);
      const result = await upsertFile(path, source, pathIndex);
      if (result === "added") added++; else modified++;
    } catch (err) {
      console.warn(`Vaults | upsert failed for ${path}:`, err);
    }
  }

  let removed = 0;
  for (const path of toDelete) {
    try { await deleteFile(path); removed++; }
    catch (err) { console.warn(`Vaults | delete failed for ${path}:`, err); }
  }

  // Persist the new manifest as our new "last seen" state.
  const newLast = Object.fromEntries(remote);
  await set(SETTINGS.lastManifest, newLast);

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  ui.notifications.info(game.i18n.format("VAULTS.Sync.Done", { added, modified, removed, seconds }));
}
