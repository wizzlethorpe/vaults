// Per-vault sync orchestrator. Each call operates on one vault entry from
// the registry: fetch its manifest, diff against its lastManifest, pull
// changed body.html files in bulk, upsert the resulting journals, and
// reconcile its image cache.
//
// Takes a `host` for the module-side primitives the importer needs —
// state I/O, vault registry access, notifications. Foundry globals
// (JournalEntry, etc.) are used directly when they don't need to
// round-trip the host.

import { fetchManifest, fetchSourceBatch } from "./api.mjs";
import { upsertFile, deleteFile, buildFolderInfo, reconcileEntries } from "./importer.mjs";
import { buildPathIndex } from "./links.mjs";
import { syncImages } from "./media.mjs";
import { localizeOr } from "./util.mjs";
import * as progress from "./progress.mjs";
import { applyInstance, deleteInstance, findMissingDocuments, missingBasePackages } from "./instance.mjs";
import { instanceId } from "./ids.mjs";
import { tokenInfo } from "./auth.mjs";
import { openTarget } from "./target.mjs";

// `foundry.base` may name a world document another page instantiates
// (`base: Actor.<id>`), which lets one page reskin another's statblock.
// Cloning reads the template at create time, so the template has to exist
// first. Processed the wrong way round, the clone finds nothing, warns, and
// the page stays uninstantiated until some later sync happens to touch it
// again. Ordering the batch removes the dependence on manifest order.
//
// Stable by construction: pages with no such dependency keep their original
// position, and a dependency cycle degrades to the original order rather
// than looping.
async function orderByBaseDeps(vault, paths, bodyMetaIndex) {
  // Which page in this batch creates which world document.
  const ownerOf = new Map();
  for (const p of paths) {
    const fm = bodyMetaIndex.get(p)?.foundry;
    if (!fm?.base) continue;
    const id = typeof fm.id === "string" && fm.id
      ? fm.id
      : await instanceId(vault.id, p.replace(/\.body\.html$/i, ".md"));
    ownerOf.set(id, p);
  }
  if (!ownerOf.size) return paths;

  // page -> the page whose document it clones, when that page is in this batch.
  const dependsOn = new Map();
  for (const p of paths) {
    const base = bodyMetaIndex.get(p)?.foundry?.base;
    const match = typeof base === "string" && base.match(/^(?:Actor|Item)\.([A-Za-z0-9]{16})$/);
    const from = match && ownerOf.get(match[1]);
    if (from && from !== p) dependsOn.set(p, from);
  }
  if (!dependsOn.size) return paths;

  const ordered = [];
  const placed = new Set();
  const visit = (p, chain) => {
    if (placed.has(p) || chain.has(p)) return;
    chain.add(p);
    const from = dependsOn.get(p);
    if (from) visit(from, chain);
    if (!placed.has(p)) { placed.add(p); ordered.push(p); }
  };
  for (const p of paths) visit(p, new Set());
  return ordered;
}

/**
 * @returns A SyncResult shape consumed by the host:
 *   {
 *     ok: boolean,
 *     refreshHandlerAssets: boolean,   // host re-applies CSS/JS post-sync
 *     added, modified, removed,
 *     imageStats, instances,
 *     skipped,                         // [{ path, reason }] declared a
 *                                      // foundry.base but got no document
 *     failed,                          // [{ path, reason }] page didn't sync;
 *                                      // its hash is not recorded, so it retries
 *   }
 */
/**
 * Run a sync, always closing the progress bar afterwards.
 *
 * The bar is a permanent notification, so any path out of runSync — an early
 * return for an up-to-date vault, a failed fetch, an unexpected throw — has to
 * take it down. A wrapper does that once; the alternative was an end() call at
 * each of the exits, which is the kind of thing that stays correct only until
 * someone adds the next return.
 */
export async function sync(host, vault, opts = {}) {
  try {
    return await runSync(host, vault, opts);
  } finally {
    progress.end();
  }
}

async function runSync(host, vault, { forceFull = false } = {}) {
  if (!vault?.url) {
    host.notify("error", host.localize("VAULTS.Sync.NoUrl"));
    return { ok: false, refreshHandlerAssets: false };
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
      await host.updateVaultEntry(vault.id, { token: "", role: "" });
      host.notify("warn", host.localize("VAULTS.Sync.TokenExpired", { name: vault.label }));
      return { ok: false, refreshHandlerAssets: false };
    }
  }

  const start = Date.now();
  host.notify("info", host.localize("VAULTS.Sync.StartingNamed", { name: vault.label }));
  progress.begin(vault.label);

  let manifest;
  try {
    manifest = await fetchManifest(vault);
  } catch (err) {
    host.notify("error", host.localize("VAULTS.Sync.Error", { message: err.message }));
    return { ok: false, refreshHandlerAssets: false };
  }
  // A higher manifest_version means the deploy was built by a newer CLI
  // than this module knows about. Warn but continue — additive changes
  // are forward-safe.
  const OUR_MANIFEST_VERSION = 1;
  const remoteManifestVersion = Number(manifest.manifest_version) || 0;
  if (remoteManifestVersion > OUR_MANIFEST_VERSION) {
    console.warn(
      `Vaults | ${vault.label}: deploy manifest_version=${remoteManifestVersion}, `
      + `our module supports up to ${OUR_MANIFEST_VERSION}. Some new fields may be ignored. `
      + `cli_version: ${manifest.cli_version || "(unknown)"}`,
    );
  }
  // Self-correcting: every manifest fetch refreshes the cached public flag
  // and the role list, so deploy-side changes (single↔multi-role, role
  // added/removed) pick up on the next sync without manual reconfiguration.
  // Fallbacks cover older deploys whose manifest predates these fields.
  const isPublic = manifest.auth?.required === false;
  const knownRoles = Array.isArray(manifest.auth?.roles) ? manifest.auth.roles : [];
  const patch = {};
  if (vault.public !== isPublic) patch.public = isPublic;
  // Which shape to build. A deploy that predates the setting advertises
  // nothing, and reads as "compendium" — what the module produced before there
  // was a choice.
  const foundryPackage = manifest.foundry_package || "compendium";
  if (vault.foundryPackage !== foundryPackage) patch.foundryPackage = foundryPackage;
  if (!arraysEqual(vault.knownRoles, knownRoles)) patch.knownRoles = knownRoles;
  // Cache the manifest's advertised asset paths so applyHandlerAssetsWithConfirm can
  // fetch them via the canonical URL. A bundle the manifest doesn't advertise
  // stays null, and the apply step skips it rather than probing a path the
  // deploy never built (which would 404).
  const remoteAssets = manifest.assets?.foundry || {};
  const newAssetPaths = {
    foundryJs: remoteAssets.js || null,
    foundryCss: remoteAssets.css || null,
  };
  if (JSON.stringify(vault.handlerAssetPaths || {}) !== JSON.stringify(newAssetPaths)) {
    patch.handlerAssetPaths = newAssetPaths;
  }
  // If the configured dmRole no longer exists in the deploy (role was
  // removed), drop it; the user can re-set on the next settings open.
  if (vault.dmRole && !knownRoles.includes(vault.dmRole)) patch.dmRole = "";
  if (Object.keys(patch).length > 0) {
    await host.updateVaultEntry(vault.id, patch);
    Object.assign(vault, patch);
  }

  // `foundry.sync: false` keeps a page out of Foundry entirely. Dropping its
  // body row here makes the page indistinguishable, to everything below, from
  // one that was never published: it is never upserted, wikilinks to it fall
  // back to plain text, and a page that synced before the flag was set lands
  // in toDelete on the next run. Only `.body.html` rows carry page meta, so
  // image and asset rows pass through untouched.
  const files = manifest.files.filter(
    (f) => !(f.path.endsWith(".body.html") && f.meta?.foundry?.sync === false),
  );

  const remote = new Map(files.map((f) => [f.path, f.hash]));
  // Per-vault sync state lives behind host.getVaultState, which the host
  // backs with whatever storage it prefers (currently the vaultManifests
  // world setting).
  const lastSync = host.getVaultState(vault.id);

  // Every document in this world is addressed by an id derived from the
  // scheme the CLI advertises. If that scheme ever changes, previously
  // synced entries become unreachable — the diff would look clean while the
  // module silently created a duplicate set beside them, and no amount of
  // re-syncing would reconcile it. So a change forces a full pass, which
  // re-derives every id and updates the documents we already own.
  const remoteIdScheme = manifest.id_scheme || "v1";
  const schemeChanged = !!lastSync.lastIdScheme && lastSync.lastIdScheme !== remoteIdScheme;
  if (schemeChanged) {
    console.warn(
      `Vaults | ${vault.label}: document id scheme changed `
      + `(${lastSync.lastIdScheme} → ${remoteIdScheme}); forcing a full re-sync so `
      + `existing documents are re-derived rather than duplicated.`,
    );
  }
  const fullPass = forceFull || schemeChanged;
  const local = fullPass ? new Map() : new Map(Object.entries(lastSync.lastManifest || {}));

  const bodyPaths = files.filter((f) => f.path.endsWith(".body.html")).map((f) => f.path);
  const pathIndex = buildPathIndex(files);
  // Folder info is built from every syncable page, not just the changed
  // subset — trivial-collapse depends on counting every sibling, not only
  // the ones we're about to upsert. Rebuilding each sync is fine; this is a
  // single linear pass over the manifest.
  const allMdPaths = bodyPaths.map((p) => p.replace(/\.body\.html$/i, ".md"));
  const folderInfo = buildFolderInfo(allMdPaths);
  // Per-body reskin metadata (foundry: { base, data, embed }, image URL).
  // Only present on pages that opted in; the rest skip applyReskin entirely.
  const bodyMetaIndex = new Map();
  for (const f of files) {
    if (f.meta && f.path.endsWith(".body.html")) bodyMetaIndex.set(f.path, f.meta);
  }

  // Checked against the whole manifest, not just the changed subset, and
  // before the up-to-date early return: an unresolvable base produces no
  // document on the sync that first sees the page, and every sync after
  // that reports "already up to date" while the documents stay missing.
  const missingPackages = await missingBasePackages(bodyMetaIndex.values());
  if (missingPackages.size > 0) {
    const summary = [...missingPackages].map(([pkg, n]) => `${pkg} (${n})`).join(", ");
    host.notify("warn", host.localize("VAULTS.Sync.MissingPackages", { packages: summary }));
    console.warn(
      `Vaults | ${vault.label}: foundry.base points into package(s) this world can't read: ${summary}. `
      + `Those pages will sync as journals but instantiate no document.`,
    );
  }

  // A page's HTML carries `?v=<hash>` on every image it shows, so that a
  // changed picture is a changed URL and the browser stops serving the one it
  // cached. That only works if the page is rewritten when the picture moves —
  // and an image-only change leaves the body hash alone, so hash-diffing the
  // bodies would skip exactly the pages that need it. Each page therefore
  // records which media it referenced last time, and a page is stale when its
  // body changed *or* any of that media did.
  //
  // Read before syncImages runs, since that is what advances the image state.
  const prevImages = forceFull ? new Map() : new Map(Object.entries(lastSync.lastImageManifest || {}));
  const lastMediaRefs = lastSync.lastMediaRefs || {};
  const mediaStale = (bodyPath) =>
    (lastMediaRefs[bodyPath] || []).some((m) => remote.get(m) !== prevImages.get(m));

  const changed = bodyPaths.filter((p) => remote.get(p) !== local.get(p) || mediaStale(p));
  const toUpsert = await orderByBaseDeps(vault, changed, bodyMetaIndex);
  const toDelete = [...local.keys()].filter((p) => p.endsWith(".body.html") && !remote.has(p));

  // Pull any new/changed images first so the freshly-rendered <img src>
  // URLs in journal HTML resolve immediately.
  if (forceFull) await host.setVaultState(vault.id, { lastImageManifest: {} });
  let imageStats = { downloaded: 0, removed: 0, errors: 0 };
  try {
    imageStats = await syncImages(host, vault, files);
  } catch (err) {
    console.warn(`Vaults | image sync failed for ${vault.label}:`, err);
  }

  // Drift check, before the up-to-date return below — which is the exact case
  // it exists to catch. Everything else here only visits *changed* pages, so a
  // document deleted in the world, or one that failed to instantiate on the
  // sync that first saw its page, is invisible from then on: the manifest
  // still matches and every later run reports "already up to date". This asks
  // the world instead of the manifest.
  //
  // Reports rather than repairs, deliberately. Re-creating a document the GM
  // deleted on purpose would fight the same rule that stops us deleting one
  // they took over. Force Sync is the repair.
  // Only the pages this run will *not* touch. A page in toUpsert is about to
  // be created or updated, so reporting it as missing would be describing the
  // state a moment before we fix it.
  const untouched = new Set(bodyPaths);
  for (const p of toUpsert) untouched.delete(p);
  for (const p of toDelete) untouched.delete(p);
  const target = await openTarget(vault);
  const missingDocs = await findMissingDocuments(target, vault, [...untouched].map((bodyPath) => ({
    logicalPath: bodyPath.replace(/\.body\.html$/i, ".md"),
    meta: bodyMetaIndex.get(bodyPath),
  })));
  const reportMissingDocs = () => {
    if (missingDocs.length === 0) return;
    host.notify("warn", host.localize("VAULTS.Sync.MissingDocuments", { count: missingDocs.length }));
    console.warn(
      `Vaults | ${vault.label}: ${missingDocs.length} page(s) have no document in this world. `
      + `An incremental sync will not notice them again — use Force Sync to restore:`,
      missingDocs,
    );
  };

  if (toUpsert.length === 0 && toDelete.length === 0 && imageStats.downloaded === 0 && imageStats.removed === 0) {
    host.notify("info", host.localize("VAULTS.Sync.NothingToDo"));
    reportMissingDocs();
    return {
      ok: true, refreshHandlerAssets: false,
      added: 0, modified: 0, removed: 0, imageStats, instances: 0, skipped: [], failed: [],
      // The drift list is computed above this return, so report it here too —
      // an up-to-date sync with missing documents is exactly the case a caller
      // most wants to see.
      missingDocuments: missingDocs,
    };
  }

  host.notify("info",
    fullPass
      ? host.localize("VAULTS.Sync.Initial", { count: toUpsert.length })
      : host.localize("VAULTS.Sync.Incremental", {
          add: toUpsert.length, mod: 0, del: toDelete.length,
        }),
  );

  let bodies;
  try {
    // One batch per role, each asking for that role's own rendering.
    //
    // Fetching everything as the syncing user leaked: a page marked
    // `role: public` is given player-readable ownership below, so filling it
    // with the DM's rendering put DM content in front of players. A base view
    // filtered by role is exactly that — the same page lists three creatures
    // for the DM and one for everyone else.
    const byRole = new Map();
    for (const bodyPath of toUpsert) {
      const pageRole = bodyMetaIndex.get(bodyPath)?.role;
      const key = pageRole || "";
      if (!byRole.has(key)) byRole.set(key, []);
      byRole.get(key).push(bodyPath);
    }
    bodies = new Map();
    for (const [pageRole, group] of byRole) {
      const fetched = await fetchSourceBatch(vault, group, pageRole || undefined);
      for (const [k, v] of fetched) bodies.set(k, v);
    }
  } catch (err) {
    console.error(`Vaults | batch fetch failed for ${vault.label}:`, err);
    host.notify("error", host.localize("VAULTS.Sync.Error", { message: err.message }));
    return { ok: false, refreshHandlerAssets: false };
  }

  // Foundry's data layer doesn't love concurrent JournalEntry.create calls
  // on the same world, and the bottleneck has moved off the network.
  let added = 0, modified = 0, instances = 0;
  // Pages that declared foundry.base but produced no document: { path, reason }.
  const skipped = [];
  // Documents that resolved but were exported for a different Foundry
  // generation. Imported anyway — most of a stale document migrates — and
  // reported together at the end, where a reader will actually see it.
  const versionSkew = [];
  // Body paths whose sync failed. Their hash must not be recorded as synced:
  // the next run diffs the manifest against what we persist here, so a failed
  // page that looks synced is never fetched again and the failure becomes
  // permanent, with every later sync reporting "already up to date".
  const failedPages = new Map(); // bodyPath → reason
  // Carried forward for pages we didn't touch, replaced for the ones we did,
  // and dropped for pages that left the manifest.
  const mediaRefs = {};
  for (const p of bodyPaths) if (lastMediaRefs[p]) mediaRefs[p] = lastMediaRefs[p];
  progress.phase("Pages", toUpsert.length);
  for (const bodyPath of toUpsert) {
    progress.step(bodyPath.replace(/\.body\.html$/i, "").split("/").pop());
    const html = bodies.get(bodyPath);
    if (html == null) {
      console.warn(`Vaults | server returned no content for ${bodyPath}`);
      failedPages.set(bodyPath, "no content returned");
      continue;
    }
    const logicalPath = bodyPath.replace(/\.body\.html$/i, ".md");
    const pageMeta = bodyMetaIndex.get(bodyPath);
    try {
      // `foundry.journal: false` keeps the article out of the sidebar while
      // still making whatever the page instantiates. Deleting rather than
      // simply skipping means setting the flag on a page that already synced
      // takes its journal page away, instead of leaving it behind for good.
      if (pageMeta?.foundry?.journal === false) {
        await deleteFile(target, vault, logicalPath);
      } else {
        const refs = new Set();
        const result = await upsertFile(target, vault, logicalPath, html, pathIndex, pageMeta, folderInfo, refs);
        mediaRefs[bodyPath] = [...refs];
        if (result === "added") added++; else modified++;
      }
      // Instantiation (clone or blank) runs after the JournalEntryPage
      // exists so the @Embed[…] in the doc description resolves on first
      // render. Only fires when the page declared foundry.base.
      if (pageMeta?.foundry?.base) {
        try {
          const outcome = await applyInstance(target, vault, logicalPath, pageMeta, { forceFull: fullPass });
          // A declared base that produced no document returns { ok: false }
          // rather than throwing, so counting calls instead of outcomes would
          // report every skipped page as a success.
          if (outcome?.ok) {
            instances++;
            if (outcome.skew) versionSkew.push({ path: logicalPath, ...outcome.skew });
          } else if (outcome) skipped.push({ path: logicalPath, reason: outcome.reason });
        } catch (err) {
          console.warn(`Vaults | foundry instantiation failed for ${logicalPath}:`, err);
          skipped.push({ path: logicalPath, reason: "threw" });
        }
      }
    } catch (err) {
      console.warn(`Vaults | upsert failed for ${logicalPath}:`, err);
      failedPages.set(bodyPath, err?.message || "upsert threw");
    }
  }

  let removed = 0;
  const failedDeletes = new Set();
  if (toDelete.length > 0) progress.phase("Removing", toDelete.length);
  for (const bodyPath of toDelete) {
    const logicalPath = bodyPath.replace(/\.body\.html$/i, ".md");
    progress.step(logicalPath.split("/").pop());
    try { await deleteFile(target, vault, logicalPath); removed++; }
    catch (err) {
      console.warn(`Vaults | delete failed for ${logicalPath}:`, err);
      // Same reasoning as a failed upsert, mirrored: the path is absent from
      // the manifest, so recording that absence would drop it out of the
      // delete set and strand the journal in the world for good.
      failedDeletes.add(bodyPath);
    }
    // Tear down the derived Actor/Item too. Best-effort; only acts on docs
    // we created (vault flag check inside).
    try { await deleteInstance(target, vault, logicalPath); }
    catch (err) { console.warn(`Vaults | delete instance failed for ${logicalPath}:`, err); }
  }

  // Record what actually synced, not what the manifest offered. A path that
  // failed keeps its previous hash (or none at all), so it stays in the diff
  // and is retried on the next run.
  const persisted = new Map(remote);
  for (const bodyPath of failedPages.keys()) {
    const previous = local.get(bodyPath);
    if (previous === undefined) persisted.delete(bodyPath);
    else persisted.set(bodyPath, previous);
  }
  for (const bodyPath of failedDeletes) {
    const previous = local.get(bodyPath);
    if (previous !== undefined) persisted.set(bodyPath, previous);
  }
  await host.setVaultState(vault.id, {
    lastManifest: Object.fromEntries(persisted),
    lastMediaRefs: mediaRefs,
    lastIdScheme: remoteIdScheme,
  });

  // Re-file entries whose leaf-collapse status changed since the last sync
  // (a folder gained or lost subfolders), and bring per-page ownership back
  // in line with the manifest's roles — which catches pages whose role
  // flipped while their body hash did not, so they never appeared above.
  await reconcileEntries(target, vault, folderInfo, bodyMetaIndex);

  // An adventure is one document, so everything above only staged changes in
  // memory; this is where the sync actually lands. Before the state is
  // persisted, so a failure here leaves the pages in the diff to retry.
  await target.commit();

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  host.notify("info", host.localize("VAULTS.Sync.Done", { added, modified, removed, seconds }));
  reportMissingDocs();
  if (imageStats.downloaded > 0 || imageStats.removed > 0) {
    console.info(`Vaults | ${vault.label} images: ${imageStats.downloaded} downloaded, ${imageStats.removed} removed`
      + (imageStats.errors ? `, ${imageStats.errors} failed` : ""));
  }
  if (instances > 0) console.info(`Vaults | ${vault.label} instantiated ${instances} document(s) from page foundry.base.`);
  // A silent skip here used to look like a clean sync: the journal pages land,
  // the actors never do, and the only trace is a console warning. Surface it.
  if (versionSkew.length > 0) {
    host.notify("warn", localizeOr(host, "VAULTS.Sync.VersionSkew",
      "{count} document(s) came from a different Foundry generation and may not render "
      + "correctly. See the console for which pack, and which version it targets.",
      { count: versionSkew.length }));
    console.warn(
      `Vaults | ${vault.label}: ${versionSkew.length} document(s) were exported for a different `
      + `Foundry generation than this world (${game.release?.generation}). They import, but parts `
      + `of a stale document may not place correctly — a Foundry 13 Scene keeps its walls and `
      + `lights but draws its tiles at the canvas origin. Ask the creator for a re-export, or `
      + `point the base at a pack built for this generation:`,
      versionSkew,
    );
  }
  if (failedPages.size > 0) {
    host.notify("warn", host.localize("VAULTS.Sync.PagesFailed", { count: failedPages.size }));
    console.warn(`Vaults | ${vault.label} failed to sync ${failedPages.size} page(s); they stay in the diff and retry next sync:`,
      [...failedPages].map(([path, reason]) => ({ path, reason })));
  }
  if (skipped.length > 0) {
    host.notify("warn", host.localize("VAULTS.Sync.InstancesSkipped", { count: skipped.length }));
    console.warn(`Vaults | ${vault.label} no document created for ${skipped.length} page(s):`, skipped);
  }

  // Handler-asset refresh is module-side (settings + DOM injection), so the
  // host re-applies post-sync when we flag it. No-op if both per-vault
  // toggles are off.
  return {
    ok: true, refreshHandlerAssets: true,
    added, modified, removed, imageStats, instances, skipped,
    missingDocuments: missingDocs,
    failed: [...failedPages].map(([path, reason]) => ({ path, reason })),
  };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
