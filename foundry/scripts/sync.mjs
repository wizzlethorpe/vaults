// Top-level sync orchestrator.
//
// Pull /_manifest.json, diff against last-known hashes (stored in world
// settings), upsert/delete journals for the difference. Hashes come from
// the manifest itself (MD5 of the served file content), so the diff is just
// a key-by-key compare of two flat objects.

import { SETTINGS, get, set } from "./settings.mjs";
import { fetchManifest, fetchSourceBatch } from "./api.mjs";
import { upsertFile, deleteFile } from "./importer.mjs";
import { buildPathIndex } from "./links.mjs";
import { syncImages } from "./media.mjs";

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

  const bodyPaths = manifest.files.filter((f) => f.path.endsWith(".body.html")).map((f) => f.path);
  const pathIndex = buildPathIndex(manifest.files);

  // Diff on body.html paths — any whose hash differs needs an upsert; any
  // local entry not in the remote manifest needs a delete.
  const toUpsert = bodyPaths.filter((p) => remote.get(p) !== local.get(p));
  const toDelete = [...local.keys()].filter((p) => p.endsWith(".body.html") && !remote.has(p));

  // Pull any new/changed images into the world's data dir before upserting
  // journals — that way the freshly-rendered <img src="worlds/…"> URLs
  // resolve immediately. forceFull blanks the local image manifest so a
  // Reset re-downloads everything.
  if (forceFull) await set(SETTINGS.lastImageManifest, {});
  let imageStats = { downloaded: 0, removed: 0, errors: 0 };
  try {
    imageStats = await syncImages(manifest.files);
  } catch (err) {
    console.warn("Vaults | image sync failed:", err);
  }

  if (toUpsert.length === 0 && toDelete.length === 0 && imageStats.downloaded === 0 && imageStats.removed === 0) {
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

  let bodies;
  try {
    bodies = await fetchSourceBatch(toUpsert);
  } catch (err) {
    console.error("Vaults | batch fetch failed:", err);
    ui.notifications.error(game.i18n.format("VAULTS.Sync.Error", { message: err.message }));
    return;
  }

  // Upserts run sequentially — Foundry's data layer doesn't love concurrent
  // JournalEntry.create() on the same world, and the bottleneck has moved
  // off the network anyway.
  let added = 0, modified = 0;
  for (const bodyPath of toUpsert) {
    const html = bodies.get(bodyPath);
    if (html == null) {
      console.warn(`Vaults | server returned no content for ${bodyPath}`);
      continue;
    }
    const logicalPath = bodyPath.replace(/\.body\.html$/i, ".md");
    try {
      const result = await upsertFile(logicalPath, html, pathIndex);
      if (result === "added") added++; else modified++;
    } catch (err) {
      console.warn(`Vaults | upsert failed for ${logicalPath}:`, err);
    }
  }

  let removed = 0;
  for (const bodyPath of toDelete) {
    const logicalPath = bodyPath.replace(/\.body\.html$/i, ".md");
    try { await deleteFile(logicalPath); removed++; }
    catch (err) { console.warn(`Vaults | delete failed for ${logicalPath}:`, err); }
  }

  // Persist the new manifest as our new "last seen" state.
  const newLast = Object.fromEntries(remote);
  await set(SETTINGS.lastManifest, newLast);

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  ui.notifications.info(game.i18n.format("VAULTS.Sync.Done", { added, modified, removed, seconds }));
  if (imageStats.downloaded > 0 || imageStats.removed > 0) {
    console.info(`Vaults | images: ${imageStats.downloaded} downloaded, ${imageStats.removed} removed`
      + (imageStats.errors ? `, ${imageStats.errors} failed` : ""));
  }
}
