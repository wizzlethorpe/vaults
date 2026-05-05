// Per-vault sync orchestrator. Each call operates on one vault entry from
// the registry: fetch its manifest, diff against its lastManifest, pull
// changed body.html files in bulk, upsert the resulting journals, and
// reconcile its image cache.

import { fetchManifest, fetchSourceBatch } from "./api.mjs";
import { upsertFile, deleteFile } from "./importer.mjs";
import { buildPathIndex } from "./links.mjs";
import { syncImages } from "./media.mjs";
import { applyInstance, deleteInstance } from "./instance.mjs";
import { tokenInfo } from "./auth.mjs";
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

  // Defensive token-expiry check. Without this, an expired bearer falls
  // through server-side to the lowest role (public) and the user's
  // higher-tier journals would silently get overwritten with public-tier
  // versions on the next sync. Clear the dead token so the row UI shows
  // the Authenticate button again, then bail.
  if (vault.token) {
    const info = tokenInfo(vault.token);
    const stillValid = info?.expiresAt && info.expiresAt > new Date();
    if (!stillValid) {
      await updateVault(vault.id, { token: "", role: "" });
      ui.notifications.warn(game.i18n.format("VAULTS.Sync.TokenExpired", { name: vault.label }));
      return;
    }
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
  // Self-correcting: every manifest fetch refreshes the cached public flag
  // and the role list, so deploy-side changes (single↔multi-role, role
  // added/removed) pick up on the next sync without manual reconfiguration.
  // Fallbacks cover older deploys whose manifest predates these fields.
  const isPublic = manifest.auth?.required === false;
  const knownRoles = Array.isArray(manifest.auth?.roles) ? manifest.auth.roles : [];
  const patch = {};
  if (vault.public !== isPublic) patch.public = isPublic;
  if (!arraysEqual(vault.knownRoles, knownRoles)) patch.knownRoles = knownRoles;
  // If the configured dmRole no longer exists in the deploy (role was
  // removed), drop it; the user can re-set on the next settings open.
  if (vault.dmRole && !knownRoles.includes(vault.dmRole)) patch.dmRole = "";
  if (Object.keys(patch).length > 0) {
    await updateVault(vault.id, patch);
    Object.assign(vault, patch);
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
  let added = 0, modified = 0, instances = 0;
  for (const bodyPath of toUpsert) {
    const html = bodies.get(bodyPath);
    if (html == null) {
      console.warn(`Vaults | server returned no content for ${bodyPath}`);
      continue;
    }
    const logicalPath = bodyPath.replace(/\.body\.html$/i, ".md");
    const pageMeta = bodyMetaIndex.get(bodyPath);
    try {
      const result = await upsertFile(vault, logicalPath, html, pathIndex, pageMeta);
      if (result === "added") added++; else modified++;
      // Clone-from-foundry_base runs after the JournalEntryPage exists so the
      // @Embed[…] in the doc description resolves on first render.
      if (pageMeta?.foundry_base) {
        try {
          await applyInstance(vault, logicalPath, pageMeta);
          instances++;
        } catch (err) {
          console.warn(`Vaults | foundry_base apply failed for ${logicalPath}:`, err);
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
    // Tear down the derived Actor/Item too. Best-effort; only acts on docs
    // we created (vault flag check inside).
    try { await deleteInstance(vault, logicalPath); }
    catch (err) { console.warn(`Vaults | delete instance failed for ${logicalPath}:`, err); }
  }

  await updateVault(vault.id, { lastManifest: Object.fromEntries(remote) });

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  ui.notifications.info(game.i18n.format("VAULTS.Sync.Done", { added, modified, removed, seconds }));
  if (imageStats.downloaded > 0 || imageStats.removed > 0) {
    console.info(`Vaults | ${vault.label} images: ${imageStats.downloaded} downloaded, ${imageStats.removed} removed`
      + (imageStats.errors ? `, ${imageStats.errors} failed` : ""));
  }
  if (instances > 0) console.info(`Vaults | ${vault.label} instantiated ${instances} document(s) from foundry_base.`);
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
