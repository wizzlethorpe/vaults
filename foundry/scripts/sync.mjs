// Per-vault sync orchestrator. Each call operates on one vault entry from
// the registry: fetch its manifest, diff against its lastManifest, pull
// changed body.html files in bulk, upsert the resulting journals, and
// reconcile its image cache.

import { fetchManifest, fetchSourceBatch } from "./api.mjs";
import { upsertFile, deleteFile } from "./importer.mjs";
import { buildPathIndex } from "./links.mjs";
import { syncImages } from "./media.mjs";
import { applyReskin } from "./reskin.mjs";
import { getVault, updateVault } from "./vaults.mjs";

export async function sync(vaultId, { forceFull = false } = {}) {
  const vault = getVault(vaultId);
  if (!vault) {
    ui.notifications.error(`Vaults | unknown vault: ${vaultId}`);
    return;
  }
  if (!vault.url) {
    ui.notifications.error(game.i18n.localize("VAULTS.Sync.NoUrl"));
    return;
  }

  const start = Date.now();
  ui.notifications.info(game.i18n.format("VAULTS.Sync.StartingNamed", { name: vault.label }));

  let manifest;
  try {
    manifest = await fetchManifest(vault);
  } catch (err) {
    ui.notifications.error(game.i18n.format("VAULTS.Sync.Error", { message: err.message }));
    return;
  }
  const remote = new Map(manifest.files.map((f) => [f.path, f.hash]));
  const local = forceFull ? new Map() : new Map(Object.entries(vault.lastManifest || {}));

  const bodyPaths = manifest.files.filter((f) => f.path.endsWith(".body.html")).map((f) => f.path);
  const pathIndex = buildPathIndex(manifest.files);
  // Per-body reskin metadata (foundry_base UUID, override block, image URL).
  // Only present on pages that opted in; the rest skip applyReskin entirely.
  const bodyMetaIndex = new Map();
  for (const f of manifest.files) {
    if (f.meta && f.path.endsWith(".body.html")) bodyMetaIndex.set(f.path, f.meta);
  }

  const toUpsert = bodyPaths.filter((p) => remote.get(p) !== local.get(p));
  const toDelete = [...local.keys()].filter((p) => p.endsWith(".body.html") && !remote.has(p));

  // Pull any new/changed images first so the freshly-rendered <img src>
  // URLs in journal HTML resolve immediately.
  if (forceFull) await updateVault(vault.id, { lastImageManifest: {} });
  let imageStats = { downloaded: 0, removed: 0, errors: 0 };
  try {
    const fresh = getVault(vault.id); // re-read after the forceFull reset
    imageStats = await syncImages(fresh, manifest.files);
  } catch (err) {
    console.warn(`Vaults | image sync failed for ${vault.label}:`, err);
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
    bodies = await fetchSourceBatch(vault, toUpsert);
  } catch (err) {
    console.error(`Vaults | batch fetch failed for ${vault.label}:`, err);
    ui.notifications.error(game.i18n.format("VAULTS.Sync.Error", { message: err.message }));
    return;
  }

  // Foundry's data layer doesn't love concurrent JournalEntry.create calls
  // on the same world, and the bottleneck has moved off the network.
  let added = 0, modified = 0, reskinned = 0;
  for (const bodyPath of toUpsert) {
    const html = bodies.get(bodyPath);
    if (html == null) {
      console.warn(`Vaults | server returned no content for ${bodyPath}`);
      continue;
    }
    const logicalPath = bodyPath.replace(/\.body\.html$/i, ".md");
    try {
      const result = await upsertFile(vault, logicalPath, html, pathIndex);
      if (result === "added") added++; else modified++;
      // Reskin runs after the JournalEntryPage exists so @Embed[…] resolves
      // on first render. No-ops for pages without foundry_base in their meta.
      const pageMeta = bodyMetaIndex.get(bodyPath);
      if (pageMeta?.foundry_base) {
        try {
          await applyReskin(vault, logicalPath, pageMeta);
          reskinned++;
        } catch (err) {
          console.warn(`Vaults | reskin failed for ${logicalPath}:`, err);
        }
      }
    } catch (err) {
      console.warn(`Vaults | upsert failed for ${logicalPath}:`, err);
    }
  }

  let removed = 0;
  for (const bodyPath of toDelete) {
    const logicalPath = bodyPath.replace(/\.body\.html$/i, ".md");
    try { await deleteFile(vault, logicalPath); removed++; }
    catch (err) { console.warn(`Vaults | delete failed for ${logicalPath}:`, err); }
  }

  await updateVault(vault.id, { lastManifest: Object.fromEntries(remote) });

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  ui.notifications.info(game.i18n.format("VAULTS.Sync.Done", { added, modified, removed, seconds }));
  if (imageStats.downloaded > 0 || imageStats.removed > 0) {
    console.info(`Vaults | ${vault.label} images: ${imageStats.downloaded} downloaded, ${imageStats.removed} removed`
      + (imageStats.errors ? `, ${imageStats.errors} failed` : ""));
  }
  if (reskinned > 0) console.info(`Vaults | ${vault.label} reskinned ${reskinned} document(s) from foundry_base.`);
}
