// Instantiate a world-level Foundry document from a vault page's
// `foundry: { base, data, embed }` frontmatter. We clone the template
// into the world (compendium docs are read-only; mutating world
// templates would surprise users) under a deterministic id derived
// from (vault.id, path), then layer name + cover + an `@Embed[…]` of
// the page's journal on top. Re-syncing updates the same doc in place,
// so user edits to non-canonical fields (HP, conditions) survive.

import { journalPageUuid } from "./packs.mjs";
import { entryId, pageId, instanceId, folderId, subdocId, folderOfPath } from "./ids.mjs";
import { localFileUrl } from "./media.mjs";
import { MODULE_ID } from "./settings.mjs";
import { BLANK_DOC_TYPES, docNameOf, parseFoundryBase } from "./foundry-base.mjs";
import { resolveMoulinetteDocument, resolveMoulinetteRefs } from "./moulinette.mjs";

// Where the rendered article HTML lands inside each system's document, keyed
// by (game.system.id, document name). Missing entries still create the clone;
// the embed step is just skipped with a warning. Add a row here to support a
// new system.
// Where a document's description lives, when it has one.
//
// Two tables because there are two kinds of answer. An Actor or Item keeps its
// description inside the *system's* schema, so the path is only knowable per
// system and an unknown system means no embed. A RollTable or Playlist has a
// top-level `description` that core Foundry defines and every system shares,
// so no system key applies and keying by one only hid the field.
//
// That is what this used to do: the lookup went through the system table
// first, and a RollTable fell through it on every system including dnd5e, so a
// synced table's description was always empty. Confirmed against a live world
// — dnd-tashas-cauldron's tables carry HTML in exactly this field.
//
// Cards is believed to have one too but is not listed: there was none in the
// world to check, and adding a field on a guess is how the other half of this
// bug happened.
const CORE_DESCRIPTION_FIELDS = {
  RollTable: "description",
  Playlist: "description",
};

/** Where this document type's description lives, or undefined if it has none. */
export function descriptionPathFor(docName, systemId) {
  return CORE_DESCRIPTION_FIELDS[docName] ?? DESCRIPTION_FIELDS[systemId]?.[docName];
}

const DESCRIPTION_FIELDS = {
  dnd5e: {
    Actor: "system.details.biography.value",
    Item: "system.description.value",
  },
};

// Cloning from a UUID is supported for every type vaults can instantiate —
// the same set as the blank-document form, because the real constraint is
// identical: the type needs a world collection to be created in.
//
// This was `{Actor, Item}` on the grounds that "cloning needs a
// description-embed path". It does not: buildOverlay already skips the embed
// silently when DESCRIPTION_FIELDS has no entry (that is the documented
// behaviour for an unsupported *system*), and the clone happens regardless.
// The narrower set only blocked the useful cases — most map packs ship their
// content as compendium Scenes, and those were all being skipped.



/**
 * Instantiate (or update) the document a vault page owns. No-op when there's
 * no `foundry.base`. Idempotent: re-running with unchanged inputs converges.
 *
 * Frontmatter shape:
 *   foundry:
 *     base: <UUID> | <Type>[:<subtype>]   # required to instantiate
 *     embed: true | false                  # optional, default true
 *     link: doc | journal                  # optional, default journal;
 *                                          # where wikilinks to this page point
 *     folder: "NPCs/Solaris"               # optional, nested under the
 *                                          # vault's own sidebar folder
 *     data: { … }                          # optional deep-merge overlay
 *
 * `base` accepts two forms:
 *   - **UUID** (`Compendium.dnd5e.monsters.Actor.O3ABqI55Ir1du1Xa`,
 *     `Actor.abc123`, …): clone the named template into the world.
 *   - **Type[:subtype]** (`Actor:npc`, `Item:weapon`, `Scene`, …): create a
 *     blank document of that type. `data` then populates fields. Useful
 *     when no template exists in any compendium — pure homebrew or
 *     bespoke maps/macros/decks.
 *
 * Inside `data`, an entry of an `items` array may be `{ uuid, … }` instead of
 * full item data; see `resolveItemUuids`.
 *
 * @returns `null` when the page declares nothing to instantiate,
 *   `{ ok: true, action: "created" | "updated", skew }` on success, where
 *   `skew` names a document exported for a different Foundry generation, or
 *   `{ ok: false, reason }` when a declared base produced no document.
 *   Callers count these; every non-ok path also warns with specifics.
 */
/**
 * The background image a scene shows, across both shapes the field takes.
 *
 * v14 moved it onto the Level; `background.src` at the top level is the v13
 * form, which Scene#_preCreate migrates. A vault can supply either, since
 * `foundry.data` is passed through and hand-shared scene JSON is often older.
 */
export function sceneBackgroundSrc(data) {
  const levels = Array.isArray(data?.levels) ? data.levels : [];
  const initial = levels.find((l) => l._id === data.initialLevel) ?? levels[0];
  return initial?.background?.src || data?.background?.src || null;
}

/**
 * Give a scene the thumbnail Foundry would have made for it.
 *
 * Scene#_preCreate composites one on create, but only for a real
 * `Scene.create()`. An adventure never makes one — its scenes are data in an
 * array — so they arrive with no thumb and the sheet shows a blank tile where
 * every other document has a picture.
 *
 * Best-effort by design: this needs a live canvas and the image to load, and a
 * scene that renders perfectly well is not worth failing a sync over.
 */
async function attachSceneThumb(data, docName, vaultPath) {
  if (docName !== "Scene" || data.thumb) return;
  const src = sceneBackgroundSrc(data);
  if (!src) return;
  try {
    // The dimensions Scene#createThumbnail defaults to, so these look like
    // every other scene thumbnail in the sidebar.
    const { thumb } = await foundry.helpers.media.ImageHelper.createThumbnail(
      src, { width: 300, height: 100 });
    if (thumb) data.thumb = thumb;
  } catch (err) {
    console.warn(`Vaults | could not make a scene thumbnail for ${vaultPath}:`, err);
  }
}

/**
 * Whether a page's document should carry the automatic Map Note.
 *
 * Only a Scene has anywhere to put one, and `journal: false` deletes the page's
 * JournalEntry — it exists for pages whose only job is to make a document — so
 * a note would name a page the same sync just removed. The note is how you get
 * from a scene back to its article; with no article there is nowhere to go.
 *
 * Exported because both the create and update paths ask, and because a test
 * that reimplements this would keep passing while the real thing drifted.
 */
export function wantsJournalNote(docName, fm) {
  return docName === "Scene" && fm?.journal !== false;
}

export async function applyInstance(target, vault, vaultPath, meta, { forceFull = false } = {}) {
  const fm = meta?.foundry;
  // No foundry block at all → nothing to instantiate.
  if (!fm || typeof fm !== "object") return null;
  if (fm.base === undefined || fm.base === null) return null;
  // `base` is either one spec or a priority list tried in order, so that a
  // vault degrades across worlds with different content installed: prefer the
  // paid statblock, fall back to the SRD one, fall back to a blank document
  // the page's own `data` fills in.
  const specs = Array.isArray(fm.base) ? fm.base : [fm.base];
  const candidates = specs.map(parseFoundryBase);
  if (candidates.length === 0 || candidates.some((c) => !c)) {
    console.warn(
      `Vaults | foundry.base: ${vaultPath} → unrecognised base ${JSON.stringify(fm.base)}; `
      + `expected a UUID ("Compendium.<pkg>.<pack>.Actor.<id>") or a type ("Actor:npc"), `
      + `or a list of those. Skipping.`,
    );
    return { ok: false, reason: "unparseable" };
  }

  // Read the document type off the specs rather than off a resolved template.
  // Two reasons: the existing-document check can then happen before any
  // fromUuid, so an update still works when the template's package is gone;
  // and links.mjs has to reach the same answer statically for wikilinks.
  const docNames = new Set(candidates.map(docNameOf).filter(Boolean));
  // The first candidate that *names* a type. A Moulinette rung names none —
  // only the reader's index knows what one of those is, and the CLI has to
  // reach the same answer with no lookup — so the type comes from a later
  // rung, which the CLI guarantees exists.
  const docName = [...docNames][0] ?? null;
  if (!docName) {
    console.warn(`Vaults | foundry.base: ${vaultPath} → could not read a document type from ${JSON.stringify(fm.base)}. Skipping.`);
    return { ok: false, reason: "unparseable" };
  }
  // The CLI rejects a mixed list at build time; this catches a hand-edited or
  // stale deploy, where picking the first entry's type would mis-file the doc.
  if (docNames.size > 1) {
    console.warn(
      `Vaults | foundry.base: ${vaultPath} → every entry must name the same document type, `
      + `got ${[...docNames].join(", ")}. Skipping.`,
    );
    return { ok: false, reason: "mixed-types" };
  }

  if (!CONFIG[docName]) {
    console.warn(`Vaults | foundry.base: this world has no ${docName} documents; skipping ${vaultPath}.`);
    return { ok: false, reason: "no-collection" };
  }
  // foundry.id pins this page's instance doc to an explicit Foundry id
  // (16 chars [A-Za-z0-9], validated CLI-side). Enables stable references
  // from external Foundry code (macros, scene flags) without depending on
  // path-derived SHA1s. Falls back to the deterministic id otherwise.
  const id = typeof fm.id === "string" && fm.id ? fm.id : await instanceId(vault.id, vaultPath);

  // Layer order, low → high precedence:
  //   baseData < cover-derived defaults < data_json < overlay.
  // foundry.data (inside overlay) wins so a page can patch fields out
  // of a hand-shared JSON sheet without rewriting the whole file.
  const dataJson = fm.data_json && typeof fm.data_json === "object" && !Array.isArray(fm.data_json)
    ? rewriteVaultPaths(structuredClone(fm.data_json), vault.id)
    : null;
  // `@moulinette/...` strings resolve against the reader's own Moulinette
  // library, so a vault can point at a creator's map or ambience without
  // shipping it. Unresolved references drop the field that held them, which
  // is what makes a page degrade gracefully for a reader who is not
  // subscribed rather than pointing Foundry at a file that isn't there.
  const moulinetteWarn = (msg) => console.warn(`Vaults | moulinette: ${vaultPath}: ${msg}`);
  if (dataJson) await resolveMoulinetteRefs(dataJson, moulinetteWarn);
  if (dataJson) {
    await resolveItemUuids(dataJson, vaultPath);
    await ensureEmbeddedIds(dataJson, vault.id, vaultPath);
  }
  const derived = {};
  const overlay = await buildOverlay(target, vault, vaultPath, meta, docName, derived);
  // The cover-derived token texture is a default, so it only applies when
  // nothing more specific named one.
  const tokenFloor = derived.tokenTexture
    && !dataJson?.prototypeToken?.texture?.src
    && !fm?.data?.prototypeToken?.texture?.src
    ? { prototypeToken: { texture: { src: derived.tokenTexture } } }
    : null;

  const existing = await target.get(docName, id);
  if (existing) {
    // Update: data_json + overlay applied together, since the existing
    // doc already absorbed the previous data_json on its create.
    const base = tokenFloor ? deepMerge(structuredClone(tokenFloor), dataJson ?? {}) : dataJson;
    const updatePatch = base ? deepMerge(structuredClone(base), overlay) : overlay;
    // The existing document knows its own dimensions; the patch may not
    // mention them at all. Re-placing the note each sync also puts it back
    // if a GM moved it, which is the same "the vault is the source of truth"
    // rule the rest of the overlay follows.
    if (wantsJournalNote(docName, fm)) {
      // Geometry is read separately so the patch is not padded out with
      // dimensions the update never meant to change.
      await attachJournalNote(updatePatch, {
        width: updatePatch.width ?? existing.width,
        height: updatePatch.height ?? existing.height,
        padding: updatePatch.padding ?? existing.padding,
        grid: updatePatch.grid ?? { size: existing.grid?.size },
      }, vault, vaultPath, meta);
    }
    // A GM who drags a doc into their own folder should keep it there, so an
    // ordinary sync leaves placement alone. A force-sync is the "put it back
    // the way the vault says" button, and does move it.
    if (!forceFull) delete updatePatch.folder;
    try {
      const merged = deepMerge(structuredClone(existing), updatePatch);
      // Only when there is nothing to show or the map itself moved: compositing
      // a thumbnail loads the full-size image, and a scene's background is the
      // largest file a vault ships.
      if (sceneBackgroundSrc(merged) !== sceneBackgroundSrc(existing) || !existing.thumb) {
        await attachSceneThumb(merged, docName, vaultPath);
      }
      await target.put(docName, merged);
    } catch (err) {
      console.warn(`Vaults | foundry.base update failed for ${vaultPath}:`, err);
      return { ok: false, reason: "update-failed" };
    }
    return { ok: true, action: "updated" };
  }

  // Only the create path consults `base`; an update patches the document
  // already in the world. So a priority list is evaluated once, when the
  // document is first made, and a GM who later installs a higher-priority
  // package never has a document they have been editing silently re-based.
  const resolved = await resolveBase(candidates, vaultPath);
  if (!resolved) return { ok: false, reason: "unresolved" };
  const baseData = resolved.data;

  // Create: layer data_json onto baseData first, then overlay on top.
  const baseItems = Array.isArray(baseData.items) ? baseData.items : null;
  if (tokenFloor) deepMerge(baseData, tokenFloor);
  if (dataJson) deepMerge(baseData, dataJson);
  baseData._id = id;
  deepMerge(baseData, overlay);
  // After the merges, so the note is placed against the geometry the scene
  // actually ends up with rather than whatever the frontmatter happened to say.
  if (wantsJournalNote(docName, fm)) {
    await attachJournalNote(baseData, baseData, vault, vaultPath, meta);
  }
  if (baseItems && baseData.items !== baseItems) {
    baseData.items = mergeItemsById(baseItems, baseData.items);
  }

  try {
    await attachSceneThumb(baseData, docName, vaultPath);
    await target.put(docName, baseData);
  } catch (err) {
    console.warn(`Vaults | foundry.base create failed for ${vaultPath}:`, err);
    return { ok: false, reason: "create-failed" };
  }

  // create() resolving is not proof a document exists. Foundry validates in
  // ClientDatabaseBackend##preCreateDocumentArray and, when a document fails,
  // notifies the GM and `continue`s past it — the batch completes, the promise
  // resolves, and nothing was written. Counting that as success is how a sync
  // reports "instantiated 36 documents" with 35 in the world.
  const created = await target.get(docName, id);
  if (!created) {
    console.warn(
      `Vaults | foundry.base: ${vaultPath} → ${docName} ${id} was rejected on create; `
      + `no document exists. Foundry logged the validation error separately (look for `
      + `"DataModelValidationError" above).`,
    );
    return { ok: false, reason: "create-rejected" };
  }

  // Scene thumbnails: V14's Scene._preCreate already attempts this, but it
  // only fires when `canvas.ready && initialLevel.background.src` — neither
  // is reliably true mid-sync (no scene is being viewed; the cache file
  // might still be settling), and a Foundry 13 export has no level background
  // at all because its map is a tile. An explicit post-create pass is
  // idempotent and means the scene's sidebar tile actually shows the map.
  //
  // A thumb carried in by a template does not count as having one. It names a
  // file in *that* pack's layout rather than ours, and it depicts the template
  // rather than the scene we built from it — every `foundry.data` override is
  // absent from it. Regenerating is cheap and always depicts what the reader
  // actually got.
  if (docName === "Scene" && (!created.thumb || resolved.from)) {
    try {
      const { thumb } = await created.createThumbnail();
      if (thumb) await created.update({ thumb });
      else console.warn(`Vaults | scene thumbnail came back empty for ${vaultPath}`);
    } catch (err) {
      console.warn(`Vaults | scene thumbnail generation failed for ${vaultPath}:`, err);
    }
  }

  return { ok: true, action: "created", skew: resolved.skew ?? null };
}



/**
 * Walk the priority list and return `{ data, from }` for the first entry that
 * yields usable template data, or null when none do. A blank-doc entry always
 * succeeds, so a list ending in one can't fail.
 *
 * Every rejected candidate is collected and reported together: one line naming
 * what was tried and why each failed beats a warning per entry.
 */
/**
 * Report a document exported for a different Foundry generation, or null.
 *
 * Only the generation is compared. Patch and minor differences within one
 * generation are what Foundry's own document migration exists to absorb; a
 * generation boundary is where the schema actually moves.
 */
export function generationSkew(data, ref) {
  const exported = Number.parseInt(String(data?._stats?.coreVersion ?? ""), 10);
  const world = Number(game.release?.generation);
  if (!Number.isFinite(exported) || !Number.isFinite(world) || exported === world) return null;
  return { ref, exported: data._stats.coreVersion, world: game.release.generation };
}

async function resolveBase(candidates, vaultPath) {
  const tried = [];
  for (const parsed of candidates) {
    if (parsed.kind === "blank") {
      if (tried.length > 0) {
        console.info(
          `Vaults | foundry.base: ${vaultPath} → fell back to blank `
          + `${parsed.docName}${parsed.subtype ? `:${parsed.subtype}` : ""} after `
          + `${tried.length} earlier candidate(s) did not resolve.`,
        );
      }
      return { data: parsed.subtype ? { type: parsed.subtype } : {}, from: null };
    }
    if (parsed.kind === "moulinette") {
      // Document data, not a path: a Moulinette Scene is a template the same
      // way a compendium Scene is. Slow, because the download brings the
      // scene's map, tiles and ambience with it.
      const data = await resolveMoulinetteDocument(
        parsed.ref,
        (msg) => console.warn(`Vaults | moulinette: ${vaultPath}: ${msg}`),
      );
      if (!data) { tried.push(`@moulinette/${parsed.ref} — did not resolve`); continue; }
      // Creators re-export for each Foundry generation, and a back catalogue
      // can be a generation behind. Most of a stale document migrates — a v13
      // Scene keeps its walls, lights and sounds — but not all of it: v14
      // moved the map onto Level, and draws a v13 scene's tiles at the canvas
      // origin instead of their stored x/y. We import anyway, because what
      // does survive is worth more than nothing, and report it rather than
      // leaving the reader to wonder why a map looks wrong.
      const skew = generationSkew(data, parsed.ref);
      delete data._id;
      // No compendiumSource: the document came from the reader's Moulinette
      // library, and there is no UUID in this world that names it.
      if (tried.length > 0) {
        console.info(
          `Vaults | foundry.base: ${vaultPath} → using @moulinette/${parsed.ref}; `
          + `earlier candidate(s) skipped:\n  ` + tried.join("\n  "),
        );
      }
      return { data, from: `@moulinette/${parsed.ref}`, skew };
    }
    const template = await safeFromUuid(parsed.uuid);
    if (!template) { tried.push(`${parsed.uuid} — did not resolve`); continue; }
    if (!BLANK_DOC_TYPES.includes(template.documentName)) {
      tried.push(`${parsed.uuid} — is a ${template.documentName}; vaults can instantiate ${BLANK_DOC_TYPES.join(", ")}`);
      continue;
    }
    // toObject() works on both compendium-loaded and world docs; pack-locking
    // doesn't apply because we're creating a brand-new world document.
    let data;
    try { data = template.toObject(); }
    catch (err) { tried.push(`${parsed.uuid} — unreadable: ${err.message}`); continue; }
    delete data._id;
    // Record where the document *came from*, not what we asked for. A system
    // may redirect a module's pack onto its own (dnd5e maps
    // Compendium.dnd-monster-manual.actors onto Compendium.dnd5e.actors24), so
    // the resolved document's uuid can differ from the spec — and stamping the
    // spec would name a source this world never read. Foundry's own
    // fromCompendium uses the resolved uuid for the same reason.
    const sourceUuid = template.uuid ?? parsed.uuid;
    if (sourceUuid.startsWith("Compendium.")) {
      data._stats = { ...data._stats, compendiumSource: sourceUuid };
    }
    const via = sourceUuid === parsed.uuid ? "" : ` (redirected to ${sourceUuid})`;
    if (tried.length > 0) {
      console.info(
        `Vaults | foundry.base: ${vaultPath} → using ${parsed.uuid}${via}; earlier candidate(s) skipped:\n  `
        + tried.join("\n  "),
      );
    }
    return { data, from: sourceUuid };
  }
  console.warn(
    `Vaults | foundry.base: ${vaultPath} → no candidate resolved:\n  ` + tried.join("\n  ")
    + `\n  Add a blank-document entry (e.g. "Actor:npc") as the last item so this can't fail.`,
  );
  return null;
}

/**
 * Packages named by `foundry.base` compendium UUIDs that this world cannot
 * resolve, mapped to how many pages need each.
 *
 * `applyInstance` can only report a missing base one page at a time, after
 * the fact — a vault built against a paid content module produces a warning
 * per page and no documents at all. Reading the manifest up front turns that
 * into one actionable sentence before any work starts.
 *
 * Scope `world` is skipped: a world compendium is local by definition and
 * there is no package to check it against.
 *
 * @param {Iterable<object>} metas  Page meta objects (`.foundry.base`).
 * @returns {Map<string, number>}   package id → page count. Empty when fine.
 */
export async function missingBasePackages(metas) {
  // Per page, the compendium specs it could use. A page with a blank-document
  // entry or a world-document base can never be stranded, so it is dropped
  // here rather than probed.
  const pageSpecs = [];
  for (const meta of metas) {
    const base = meta?.foundry?.base;
    if (base === undefined || base === null) continue;
    const specs = (Array.isArray(base) ? base : [base]).filter((s) => typeof s === "string");
    if (specs.length === 0) continue;
    if (specs.some((s) => !s.includes("."))) continue;
    if (specs.some((s) => !s.startsWith("Compendium."))) continue;
    // A world compendium is local by definition; there is no package to
    // report and nothing for the GM to go install.
    if (specs.some((s) => s.split(".")[1] === "world")) continue;
    pageSpecs.push(specs);
  }
  if (pageSpecs.length === 0) return new Map();

  // Ask Foundry whether a pack answers, rather than inferring it from module
  // state. A system can redirect a module's packs onto its own — dnd5e maps
  // Compendium.dnd-monster-manual.actors onto Compendium.dnd5e.actors24 — so
  // an inactive module still resolves, and `game.modules.get(id).active` would
  // report a working package as missing.
  //
  // Probed per pack rather than per page: reachability is a property of the
  // pack, and a vault can name hundreds of documents inside one. A few specs
  // each rather than one, so a single stale document id can't condemn a pack
  // that is actually fine and produce a false report for every other page
  // pointing into it.
  const PROBES_PER_PACK = 3;
  const packOf = (spec) => spec.split(".").slice(1, 3).join(".");
  const probes = new Map(); // "pkg.pack" → up to PROBES_PER_PACK specs
  for (const specs of pageSpecs) {
    for (const spec of specs) {
      const pack = packOf(spec);
      const chosen = probes.get(pack) ?? [];
      if (chosen.length < PROBES_PER_PACK && !chosen.includes(spec)) chosen.push(spec);
      probes.set(pack, chosen);
    }
  }
  const reachable = new Map();
  for (const [pack, specs] of probes) {
    let ok = false;
    for (const spec of specs) if (await safeFromUuid(spec)) { ok = true; break; }
    reachable.set(pack, ok);
  }

  const missing = new Map();
  for (const specs of pageSpecs) {
    if (specs.some((s) => reachable.get(packOf(s)))) continue;
    for (const pkg of new Set(specs.map((s) => s.split(".")[1]).filter(Boolean))) {
      missing.set(pkg, (missing.get(pkg) ?? 0) + 1);
    }
  }
  return missing;
}

/**
 * Delete the derived document for a deleted page. Best-effort: only acts when
 * the doc carries our vault flag, so we don't yank one the user took over by
 * hand.
 *
 * The page's document could be any of the supported types, and nothing here
 * records which — so this asks each of the vault's existing packs. Packs that
 * were never created are not consulted, which is most of them for most vaults.
 */
export async function deleteInstance(target, vault, vaultPath) {
  const id = await instanceId(vault.id, vaultPath);
  for (const docName of BLANK_DOC_TYPES) {
    const doc = await target.get(docName, id);
    if (!doc) continue;
    if (doc.flags?.[MODULE_ID]?.vaultId !== vault.id) continue;
    try { await target.remove(docName, id); }
    catch (err) { console.warn(`Vaults | failed to delete ${docName} for ${vaultPath}:`, err); }
  }
}

/**
 * Ensure the folder a page's instance doc belongs in inside `pack`, and return
 * its id. Returns null for a page that asked for no subfolder.
 *
 * There is no longer a per-(vault, docType) root folder to nest under: the
 * pack is that container, and it is already named after the vault. Only the
 * `subPath` ("NPCs/Solaris", from `foundry.folder`, defaulting to the page's
 * own directory) becomes folders.
 *
 * Idempotent: folder ids are deterministic, so repeated calls reuse folders
 * rather than making new ones.
 */
async function ensureInstanceFolder(target, vault, docName, subPath = "") {
  let parentId = null;
  let key = `${vault.id}/__instance__/${docName}`;
  for (const segment of splitFolderPath(subPath)) {
    key += `/${segment}`;
    const fId = await folderId(vault.id, key);
    try { await target.putFolder(docName, { _id: fId, name: segment, folder: parentId }); }
    catch (err) {
      console.warn(`Vaults | could not create ${docName} folder for ${vault.label}:`, err);
      return parentId;
    }
    parentId = fId;
  }
  return parentId;
}

/** "/NPCs//Solaris/" → ["NPCs", "Solaris"]. Tolerates the slashes authors type. */
function splitFolderPath(subPath) {
  return typeof subPath === "string" ? subPath.split("/").map(s => s.trim()).filter(Boolean) : [];
}

/**
 * Where a page's instantiated document is filed, under the vault's own root
 * folder for that document type.
 *
 * Defaults to the page's vault directory, so the sidebar mirrors the vault
 * the way journals already do (folder-as-JournalEntry). Previously the
 * default was "" and every derived document landed in one flat pile at the
 * vault root, which is why so many pages carried a `foundry.folder` that
 * merely restated the directory they were already in.
 *
 * `foundry.folder` still overrides, for the cases where the two genuinely
 * differ — most usefully when vault paths encode access rather than topic
 * ("DM Notes/...") and mirroring would put that vocabulary in front of
 * players, since Foundry folder names are visible for documents they can see.
 */
function instanceSubPath(vaultPath, meta) {
  const override = meta?.foundry?.folder;
  if (typeof override === "string" && override.trim()) return override;
  return folderOfPath(vaultPath);
}

async function buildOverlay(target, vault, vaultPath, meta, docName, derived = {}) {
  const overlay = {
    // Prefer the page's frontmatter `title:` over the filename — the wiki
    // already treats title as the page's display name, and a doc named
    // "Potion of Healing (Mossfoot Brew)" reads better in the Foundry
    // sidebar than "Healing Potion".
    name: meta.title || baseName(vaultPath),
    folder: await ensureInstanceFolder(target, vault, docName, instanceSubPath(vaultPath, meta)),
    flags: { [MODULE_ID]: { vaultId: vault.id, path: vaultPath } },
  };

  if (meta.image) {
    const localImg = imageUrlFromMeta(vault.id, meta.image);
    if (localImg) {
      overlay.img = localImg;
      // Actors carry a separate prototypeToken texture used when dragging
      // onto a scene. Default it to the page's cover so a plain page gets a
      // token picture for free — but only as a *default*: it is stamped
      // under data_json rather than over it, because a hand-authored sheet
      // that names its own token art means it. A Dynamic Token Ring subject
      // is cut round and padded; a portrait is not, and dropping a portrait
      // into the ring is exactly the wrong picture.
      if (docName === "Actor") derived.tokenTexture = localImg;
    }
  }

  // Embed the page's JournalEntryPage into the document description so the
  // wiki article shows up inline on the doc sheet. Skipped silently when
  // the system isn't in the supported table — clone still happens. Pages
  // can opt out with `foundry: { embed: false }` (e.g. stats-only pages,
  // or DM-private pages where embedding would leak content into the
  // actor sheet). Default is true.
  const fm = meta?.foundry;
  const descPath = descriptionPathFor(docName, game.system.id);
  // `journal: false` leaves no page to point at, so the embed would render
  // as a broken reference on the sheet.
  const embedAuto = fm?.embed !== false && fm?.journal !== false;
  if (descPath && embedAuto) {
    // A compendium UUID, because that is where the page's journal now lives.
    // It keeps resolving after the GM imports this document into their world:
    // the reference still points at the pack, which is the copy the vault
    // keeps up to date.
    const eId = await entryId(vault.id, vaultPath);
    const pId = await pageId(vault.id, vaultPath);
    setPath(overlay, descPath, `<p>@Embed[${journalPageUuid(vault, eId, pId)} inline]</p>`);
  }

  // User overrides win. Deep-merge so e.g. `foundry: { data: { system: {
  // attributes: { hp: { value: 45 } } } } }` patches just that leaf
  // without clobbering sibling keys we set above. Two passes happen on the
  // cloned data:
  //   - `rewriteVaultPaths` expands `@vault/PATH` strings to local cache
  //     URLs so authors can point Scene textures / Playlist sounds at
  //     vault-shipped media without hand-writing the deploy URL.
  //   - `ensureEmbeddedIds` assigns deterministic _ids to any object
  //     inside an array under foundry.data that doesn't have one. Without
  //     this, V14's EmbeddedCollectionField allocates a fresh randomID()
  //     on every update and the parent doc accrues duplicate sub-docs
  //     (walls, sounds, cards, …) on every re-sync.
  if (fm?.data && typeof fm.data === "object") {
    const cloned = rewriteVaultPaths(structuredClone(fm.data), vault.id);
    // Same treatment as data_json: `@moulinette/...` resolves against the
    // reader's own library, and an unresolved reference takes its field with it.
    await resolveMoulinetteRefs(cloned, (msg) => console.warn(`Vaults | moulinette: ${vaultPath}: ${msg}`));
    await resolveItemUuids(cloned, vaultPath);
    await ensureEmbeddedIds(cloned, vault.id, vaultPath);
    deepMerge(overlay, cloned);
  }

  return overlay;
}

/**
 * Append a Map Note linking the scene back to its source journal page, into
 * `sceneData` in place.
 *
 * It sits in the padding margin just off the map's top-left corner: half a
 * grid cell left of the grid-aligned image origin, and half a cell below the
 * top edge, sized to one grid square. The origin is grid-aligned the way
 * Foundry computes it, `ceil(padding * dim / gridSize)` cells per axis.
 *
 * Geometry is read from the scene data itself, after the base template,
 * data_json and overlay have all been merged. It used to be read from the
 * page's frontmatter, which is only right when the page carries the whole
 * scene in `data_json`. A Scene cloned from a compendium UUID — or resolved
 * from a Moulinette document — gets its width, height, grid and padding from
 * the template, and frontmatter may say nothing at all. The note was then
 * placed against 4000x3000 at grid 100 defaults and landed somewhere
 * arbitrary on a map of any other size.
 *
 * User-supplied notes survive: we append rather than replace.
 */
export function notePosition(geom) {
  const width = Number(geom.width) || 4000;
  const height = Number(geom.height) || 3000;
  const padding = Number(geom.padding ?? 0.25);
  const gridSize = Number(geom.grid?.size) || 100;
  return {
    x: gridSize * (Math.ceil((width / gridSize) * padding) - 0.5),
    y: gridSize * (Math.ceil((height / gridSize) * padding) + 0.5),
  };
}

async function attachJournalNote(sceneData, geom, vault, vaultPath, meta) {
  const gridSize = Number(geom.grid?.size) || 100;
  const { x, y } = notePosition(geom);
  const eId = await entryId(vault.id, vaultPath);
  const idOverride = meta?.foundry?.id;
  const pId = typeof idOverride === "string" && idOverride
    ? idOverride
    : await pageId(vault.id, vaultPath);
  // `entryId` is an id-only foreign field to a *world* JournalEntry, so it has
  // no way to name a pack. In an adventure that costs nothing: import creates
  // the journal with this very id, so the note resolves. In a compendium the
  // note points at nothing until the GM imports both packs with "Keep Document
  // IDs" checked. Written either way — the alternative is a scene with no way
  // back to its article, and an unresolved id stores without complaint (the
  // field validates the shape, not the target).
  const note = {
    _id: await subdocId(vault.id, vaultPath, "/notes/__journalLink__"),
    entryId: eId,
    pageId: pId,
    x,
    y,
    iconSize: gridSize,
    texture: {
      src: "icons/svg/book.svg",
      anchorX: 0.5,
      anchorY: 0.5,
      fit: "contain",
      tint: "#ffffff",
    },
    text: "",
  };
  sceneData.notes = [...(sceneData.notes ?? []), note];
}


/**
 * Walk an arbitrary value and assign deterministic _ids to objects that
 * sit inside arrays and don't already have a *valid* one. The id is derived
 * from the JSON pointer to the item, hashed with vault id + page path so
 * collisions across vaults / pages are impossible.
 *
 * "Valid" means exactly 16 [A-Za-z0-9] chars — Foundry rejects anything
 * else, and authored / exported `data_json` sheets sometimes carry short or
 * foreign sub-doc ids that would otherwise abort the whole document create
 * with an opaque validation error. We regenerate those. A malformed id is
 * not a usable reference target, so replacing it breaks nothing valid.
 *
 * Reordering an array shifts every item's _id one slot, so existing
 * Foundry-side sub-docs match by NEW position, not by their previous
 * identity. That's acceptable: reorder is a deliberate authorial action
 * and the alternative (content-hashed ids) would break in-place edits.
 *
 * Authors who want a sub-doc identity that survives reordering can pin
 * `_id` manually in the YAML; this walker leaves valid existing _ids alone.
 */
const VALID_SUBDOC_ID = /^[A-Za-z0-9]{16}$/;
/**
 * Expand `{ uuid, ... }` entries in an embedded `items` array into full item
 * data, so a page can stock a merchant or a statblock from compendium items
 * without inlining them.
 *
 * Inlining is the alternative and it is a bad one: a single spell scroll is
 * ~3KB of JSON carrying its own activities, uses and damage, so a shop of a
 * dozen wares is unreadable in frontmatter, and a hand-trimmed copy silently
 * ships items whose mechanics do not work. Here the compendium supplies the
 * item and the page supplies only what differs from it:
 *
 *   items:
 *     - uuid: "Compendium.dnd5e.items.Item.rQ6sO7HDWzqMhSI3"
 *       system: { price: { value: 50, denomination: gp }, quantity: 2 }
 *
 * Keys beside `uuid` are deep-merged over the resolved data, exactly like
 * `foundry.data` merges over its base, so there is no second syntax to learn.
 * Entries without a `uuid` are left untouched — inline items still work.
 *
 * An unresolvable uuid drops that one entry rather than failing the page: a
 * merchant missing a ware is a better sync than a merchant missing entirely.
 */
/**
 * Merge a page's `items` into the base document's own, keyed by `_id`.
 *
 * Arrays otherwise replace wholesale, which would strip a statblock's gear and
 * spells the moment a page declared any stock of its own — a shopkeeper cloned
 * from Mage would lose her spell list to four scrolls. Merging by id also lets
 * a page reach one of the base's own items by `_id` alone, which is how a
 * merchant hides the shopkeeper's weapon from the shop without restating it:
 *
 *   items:
 *     - _id: mmArcaneBurst000
 *       flags: { item-piles: { item: { hidden: true } } }
 *
 * Foundry's own update path already upserts an embedded collection by id, so
 * this only has to bring document *creation* into line with it.
 */
function mergeItemsById(baseItems, pageItems) {
  if (!Array.isArray(pageItems)) return baseItems;
  if (!baseItems.length) return pageItems;
  const merged = baseItems.map((item) => structuredClone(item));
  const positionOf = new Map(merged.map((item, i) => [item?._id, i]));
  for (const item of pageItems) {
    const at = item && item._id !== undefined ? positionOf.get(item._id) : undefined;
    if (at === undefined) merged.push(item);
    else deepMerge(merged[at], item);
  }
  return merged;
}

async function resolveItemUuids(data, vaultPath) {
  if (!Array.isArray(data?.items)) return;
  const resolved = [];
  for (const entry of data.items) {
    if (!entry || typeof entry !== "object" || typeof entry.uuid !== "string") {
      resolved.push(entry);
      continue;
    }
    const { uuid, ...overrides } = entry;
    const source = await safeFromUuid(uuid);
    if (!source) {
      console.warn(`Vaults | foundry item uuid: ${vaultPath} → ${uuid} did not resolve; skipping that item.`);
      continue;
    }
    if (source.documentName !== "Item") {
      console.warn(`Vaults | foundry item uuid: ${vaultPath} → ${uuid} is a ${source.documentName}, not an Item; skipping that item.`);
      continue;
    }
    const itemData = source.toObject();
    delete itemData._id;
    // Mirror what a manual compendium import records, so the item keeps a
    // trail back to its source for Foundry's own update-from-compendium.
    if (uuid.startsWith("Compendium.")) {
      itemData._stats = { ...itemData._stats, compendiumSource: uuid };
    }
    resolved.push(deepMerge(itemData, overrides));
  }
  data.items = resolved;
}

async function ensureEmbeddedIds(value, vaultId, pagePath, ptr = "") {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const childPtr = `${ptr}/${i}`;
      const item = value[i];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        if (typeof item._id !== "string" || !VALID_SUBDOC_ID.test(item._id)) {
          item._id = await subdocId(vaultId, pagePath, childPtr);
        }
      }
      await ensureEmbeddedIds(item, vaultId, pagePath, childPtr);
    }
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      await ensureEmbeddedIds(value[k], vaultId, pagePath, `${ptr}/${k}`);
    }
  }
}

/**
 * Walk an arbitrary value (object / array / string) and rewrite every string
 * starting with the `@vault/` sentinel to a local cache URL. Mutates and
 * returns the same value. Caller is expected to clone if it needs the input
 * preserved (we do, in buildOverlay / applyInstance).
 *
 * The sentinel was chosen to be opt-in and grep-friendly; arbitrary strings
 * in `foundry.data` (an actor's biography, a card's description) are left
 * untouched. Unmatched references (path missing from the cache) still get
 * rewritten — Foundry will 404 the asset, which is the same outcome you'd
 * get from a typo'd URL today.
 */
function rewriteVaultPaths(value, vaultId) {
  if (typeof value === "string") return rewriteVaultString(value, vaultId);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = rewriteVaultPaths(value[i], vaultId);
    return value;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = rewriteVaultPaths(value[k], vaultId);
    return value;
  }
  return value;
}

function rewriteVaultString(s, vaultId) {
  if (!s.startsWith("@vault/")) return s;
  const vaultPath = s.slice("@vault/".length);
  if (!vaultPath) return s;
  return localFileUrl(vaultId, vaultPath);
}

async function safeFromUuid(uuid) {
  try { return await fromUuid(uuid); }
  catch { return null; }
}

function baseName(path) {
  return path.split("/").pop().replace(/\.md$/i, "");
}

/**
 * Convert the CLI-emitted `image` URL (always an absolute path like
 * `/attachments/foo.webp`, or an http(s) URL) into the Foundry-served path
 * under the local image cache. External URLs pass through unchanged.
 */
function imageUrlFromMeta(vaultId, image) {
  if (/^https?:\/\//i.test(image)) return image;
  const vaultPath = decodeURIComponent(image.replace(/^\//, ""));
  if (!vaultPath) return null;
  return localFileUrl(vaultId, vaultPath);
}

/** Set `obj[a.b.c] = value`, creating intermediate objects. */
function setPath(obj, path, value) {
  const segs = path.split(".");
  let cursor = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (cursor[seg] == null || typeof cursor[seg] !== "object") cursor[seg] = {};
    cursor = cursor[seg];
  }
  cursor[segs[segs.length - 1]] = value;
  return obj;
}

/** Recursively merge plain-object source into target. Arrays + scalars replace. */
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v)
        && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/**
 * Pages whose documents are missing from the world.
 *
 * Sync diffs the remote manifest against the last one, so a page whose hash
 * has not changed is never revisited — and a document deleted in the world,
 * or one that failed to instantiate, stays missing while every later sync
 * reports "already up to date". This is the only way that drift is ever
 * noticed.
 *
 * Reports rather than repairs. The module deliberately never auto-deletes a
 * document a GM has taken over, and re-creating one they deleted on purpose
 * would fight the same principle from the other side. A force sync is the
 * "put it back the way the vault says" button, and this tells them when to
 * reach for it.
 *
 * @param entries `{ logicalPath, meta }` for every syncable page.
 * @returns `[{ path, missing }]`, `missing` being "journal", "document", or both.
 */
export async function findMissingDocuments(target, vault, entries) {
  const out = [];
  // A pack lookup is a request, not a map read, and this walks every page the
  // sync did not touch — so each pack is read once up front rather than once
  // per page. Journals need whole documents (an embedded page id is not in the
  // index); instance documents need only ids, so their index is enough.
  const journalPages = new Set();
  for (const entry of await target.contents("JournalEntry")) {
    for (const page of entry.pages ?? []) journalPages.add(`${entry._id}.${page._id}`);
  }
  const idsByType = new Map();
  const packIds = async (docName) => {
    // Nothing of a type ever created reports an empty set, so every document
    // of it is missing — which is the right answer.
    if (!idsByType.has(docName)) idsByType.set(docName, await target.ids(docName));
    return idsByType.get(docName);
  };

  for (const { logicalPath, meta } of entries) {
    const fm = meta?.foundry;
    const missing = [];

    if (fm?.journal !== false) {
      const eId = await entryId(vault.id, logicalPath);
      const pId = typeof fm?.id === "string" && fm.id ? fm.id : await pageId(vault.id, logicalPath);
      if (!journalPages.has(`${eId}.${pId}`)) missing.push("journal");
    }

    if (fm?.base !== undefined && fm?.base !== null) {
      const specs = Array.isArray(fm.base) ? fm.base : [fm.base];
      const docName = docNameOf(parseFoundryBase(specs[0]));
      if (docName) {
        const id = typeof fm.id === "string" && fm.id ? fm.id : await instanceId(vault.id, logicalPath);
        if (!(await packIds(docName)).has(id)) missing.push("document");
      }
    }

    if (missing.length > 0) out.push({ path: logicalPath, missing: missing.join(" + ") });
  }
  return out;
}
