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

  const mdPaths = manifest.files.filter((f) => f.path.endsWith(".md")).map((f) => f.path);
  const pathIndex = buildPathIndex(manifest.files);

  // Diff: any md file whose hash differs (or is new) needs an upsert; any md
  // file in local but not remote needs a delete.
  const toUpsert = mdPaths.filter((p) => remote.get(p) !== local.get(p));
  const toDelete = [...local.keys()].filter((p) => p.endsWith(".md") && !remote.has(p));

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

  // Fetch all sources in bulk via /_batch — one HTTP round trip per ~100
  // files instead of one per file. Avoids the per-URL CORS preflight that
  // tripped Cloudflare's OPTIONS rate limit on full syncs.
  let sources;
  try {
    sources = await fetchSourceBatch(toUpsert);
  } catch (err) {
    console.error("Vaults | batch fetch failed:", err);
    ui.notifications.error(game.i18n.format("VAULTS.Sync.Error", { message: err.message }));
    return;
  }

  // Upserts run sequentially — Foundry's data layer doesn't love concurrent
  // JournalEntry.create() on the same world, and the bottleneck has moved
  // off the network anyway.
  let added = 0, modified = 0;
  for (const path of toUpsert) {
    const source = sources.get(path);
    if (source == null) {
      console.warn(`Vaults | server returned no content for ${path}`);
      continue;
    }
    try {
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
  if (imageStats.downloaded > 0 || imageStats.removed > 0) {
    console.info(`Vaults | images: ${imageStats.downloaded} downloaded, ${imageStats.removed} removed`
      + (imageStats.errors ? `, ${imageStats.errors} failed` : ""));
  }
}
