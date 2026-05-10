// Instantiate a world-level Foundry document (Actor / Item) from a vault page.
// `foundry: { base: <UUID>, data: {...}, embed: false }` in page frontmatter
// names a template (or a doc type), supplies the deep-merge overlay, and
// optionally suppresses the auto-embed of the page article into the doc's
// description field. We clone the template into the world under a
// deterministic id derived from (vault.id, path), then layer on the page's
// name + cover image + an `@Embed[…]` of the page's journal so the document
// description always shows the rendered article.
//
// Why clone instead of mutate the template:
//   - Compendium docs are read-only; you can't mutate them directly.
//   - Mutating world templates breaks the obvious "this is the goblin you can
//     drop on every map" expectation.
//   - Pages stay the source of truth: a page deletion / rename can predictably
//     create or destroy its derived doc.
//
// The deterministic id means re-syncing a page updates the same Actor/Item in
// place; user-edited fields (HP, conditions, etc.) survive because we only
// overwrite the canonical "page-driven" fields plus anything in the page's
// `foundry:` override block.

import { entryId, pageId, instanceId, folderId } from "./ids.mjs";
import { localFileUrl, localImageUrl } from "./media.mjs";
import { MODULE_ID } from "./settings.mjs";

// Where the rendered article HTML lands inside each system's document, keyed
// by (game.system.id, document name). Missing entries still create the clone;
// the embed step is just skipped with a warning. Add a row here to support a
// new system.
const DESCRIPTION_FIELDS = {
  dnd5e: {
    Actor: "system.details.biography.value",
    Item: "system.description.value",
  },
};

// Document types supported by `foundry.base: <UUID>` (clone-from-template).
// Cloning needs a description-embed path, so this stays the narrow set.
const CLONE_SUPPORTED_DOCS = new Set(["Actor", "Item"]);

// Document types supported by `foundry.base: <type>[:<subtype>]` (blank doc).
// Wider since we don't need a description embed for a blank doc — the user
// drives the doc entirely via the `foundry:` overlay block.
const BLANK_DOC_TYPES = new Set([
  "Actor", "Item", "Scene", "JournalEntry",
  "RollTable", "Macro", "Cards", "Playlist",
]);

// Where each blank-supported doc lives in the world. Looked up lazily so a
// system that swaps out a collection at startup is honoured.
const COLLECTION_FOR = {
  Actor: () => game.actors,
  Item: () => game.items,
  Scene: () => game.scenes,
  JournalEntry: () => game.journal,
  RollTable: () => game.tables,
  Macro: () => game.macros,
  Cards: () => game.cards,
  Playlist: () => game.playlists,
};

/**
 * Instantiate (or update) the document a vault page owns. No-op when there's
 * no `foundry.base`. Idempotent: re-running with unchanged inputs converges.
 *
 * Frontmatter shape:
 *   foundry:
 *     base: <UUID> | <Type>[:<subtype>]   # required to instantiate
 *     embed: true | false                  # optional, default true
 *     data: { … }                          # optional deep-merge overlay
 *
 * `base` accepts two forms:
 *   - **UUID** (`Compendium.dnd5e.monsters.Actor.O3ABqI55Ir1du1Xa`,
 *     `Actor.abc123`, …): clone the named template into the world.
 *   - **Type[:subtype]** (`Actor:npc`, `Item:weapon`, `Scene`, …): create a
 *     blank document of that type. `data` then populates fields. Useful
 *     when no template exists in any compendium — pure homebrew or
 *     bespoke maps/macros/decks.
 */
export async function applyInstance(vault, vaultPath, meta) {
  const fm = meta?.foundry;
  // No foundry block at all → nothing to instantiate.
  if (!fm || typeof fm !== "object") return;
  const parsed = parseFoundryBase(fm.base);
  if (!parsed) return;

  let docName;
  let baseData;
  if (parsed.kind === "uuid") {
    const template = await safeFromUuid(parsed.uuid);
    if (!template) {
      console.warn(`Vaults | foundry.base: ${vaultPath} → ${parsed.uuid} did not resolve; skipping.`);
      return;
    }
    docName = template.documentName;
    if (!CLONE_SUPPORTED_DOCS.has(docName)) {
      console.warn(
        `Vaults | foundry.base: ${vaultPath} → ${parsed.uuid} is a ${docName}; `
        + `clone-from-UUID only supports ${[...CLONE_SUPPORTED_DOCS].join(", ")}.`,
      );
      return;
    }
    // toObject() works on both compendium-loaded and world docs; pack-locking
    // doesn't apply because we're creating a brand-new world document.
    try { baseData = template.toObject(); }
    catch (err) {
      console.warn(`Vaults | foundry.base: could not read template ${parsed.uuid}:`, err);
      return;
    }
    delete baseData._id;
  } else {
    docName = parsed.docName;
    baseData = parsed.subtype ? { type: parsed.subtype } : {};
  }

  const collection = COLLECTION_FOR[docName]?.();
  if (!collection) {
    console.warn(`Vaults | foundry.base: no world collection for ${docName}; skipping ${vaultPath}.`);
    return;
  }
  const docClass = CONFIG[docName].documentClass;
  // foundry.id pins this page's instance doc to an explicit Foundry id
  // (16 chars [A-Za-z0-9], validated CLI-side). Enables stable references
  // from external Foundry code (macros, scene flags) without depending on
  // path-derived SHA1s. Falls back to the deterministic id otherwise.
  const id = typeof fm.id === "string" && fm.id ? fm.id : await instanceId(vault.id, vaultPath);

  // Layer order, low → high precedence:
  //   1. baseData    (template clone OR { type } for blank doc)
  //   2. data_json   (user-supplied JSON file, e.g. an exported sheet)
  //   3. overlay     (page-driven name/img/embed + foundry.data)
  // data_json sits below `foundry.data` so a user can use a hand-shared
  // JSON as the base and patch its fields via the data block on top.
  const dataJson = fm.data_json && typeof fm.data_json === "object" && !Array.isArray(fm.data_json)
    ? rewriteVaultPaths(structuredClone(fm.data_json), vault.id)
    : null;
  const overlay = await buildOverlay(vault, vaultPath, meta, docName);

  const existing = collection.get(id);
  if (existing) {
    // Update: data_json + overlay applied together, since the existing
    // doc already absorbed the previous data_json on its create.
    const updatePatch = dataJson ? deepMerge(structuredClone(dataJson), overlay) : overlay;
    try {
      await existing.update(updatePatch);
    } catch (err) {
      console.warn(`Vaults | foundry.base update failed for ${vaultPath}:`, err);
    }
    return;
  }

  // Create: layer data_json onto baseData first, then overlay on top.
  if (dataJson) deepMerge(baseData, dataJson);
  baseData._id = id;
  deepMerge(baseData, overlay);

  try {
    await docClass.create(baseData, { keepId: true });
  } catch (err) {
    console.warn(`Vaults | foundry.base create failed for ${vaultPath}:`, err);
  }
}

/**
 * Parse the `foundry.base` value into either a UUID-clone form or a
 * blank-doc form. UUIDs always contain a `.` (`Type.id` at minimum); a
 * bare type name like "Actor" or "Item:weapon" never does. Case-insensitive
 * for the type so `actor:npc` reads naturally in YAML.
 *
 * Returns null for unrecognised inputs so the caller can no-op silently.
 */
function parseFoundryBase(spec) {
  if (typeof spec !== "string" || !spec) return null;
  if (spec.includes(".")) return { kind: "uuid", uuid: spec };
  const [typeRaw, subtype] = spec.split(":");
  const docName = [...BLANK_DOC_TYPES].find(t => t.toLowerCase() === typeRaw.toLowerCase());
  if (!docName) return null;
  return { kind: "blank", docName, subtype: subtype || undefined };
}

/**
 * Delete the derived document for a deleted page. Best-effort: only acts when
 * the doc carries our vault flag, so we don't yank a doc the user took over
 * by hand.
 */
export async function deleteInstance(vault, vaultPath) {
  const id = await instanceId(vault.id, vaultPath);
  for (const getCollection of Object.values(COLLECTION_FOR)) {
    const collection = getCollection();
    const doc = collection?.get(id);
    if (!doc) continue;
    if (doc.getFlag(MODULE_ID, "vaultId") !== vault.id) continue;
    try { await doc.delete(); }
    catch (err) { console.warn(`Vaults | failed to delete ${doc.documentName} for ${vaultPath}:`, err); }
  }
}

/**
 * Wipe every Actor / Item / Scene / etc. this vault instantiated, plus the
 * per-doctype folders we created for them. Called from the vault-remove
 * flow. Conservative: only touches docs carrying our vault flag (so
 * docs the GM took over by hand are safe), and only deletes folders
 * whose id matches the deterministic id we'd compute.
 */
export async function deleteVaultInstances(vault) {
  // Docs first (so the folders end up empty before we try to remove them).
  for (const [docName, getCollection] of Object.entries(COLLECTION_FOR)) {
    const collection = getCollection();
    if (!collection) continue;
    const ours = collection.contents.filter((d) => d.getFlag(MODULE_ID, "vaultId") === vault.id);
    for (const doc of ours) {
      try { await doc.delete(); }
      catch (err) { console.warn(`Vaults | failed to delete ${docName} ${doc.id} for ${vault.label}:`, err); }
    }
  }
  // Then the now-empty folders.
  for (const docName of BLANK_DOC_TYPES) {
    const fId = await instanceFolderId(vault, docName);
    const folder = game.folders.get(fId);
    if (!folder || folder.type !== docName) continue;
    if (folder.contents.length > 0 || folder.children.length > 0) continue;
    try { await folder.delete(); }
    catch (err) { console.warn(`Vaults | failed to delete ${docName} folder for ${vault.label}:`, err); }
  }
}

/** Deterministic per-(vault, docType) folder id — same key derivation
 *  family as folderId() so cleanup can recompute and find the folder. */
async function instanceFolderId(vault, docName) {
  return folderId(vault.id, `${vault.id}/__instance__/${docName}`);
}

/**
 * Ensure a per-vault folder exists for `docName` in its sidebar (Actors,
 * Items, etc.) and return its id. One level only: docs land directly in
 * the vault-named folder; folder-mirror navigation lives in the journal
 * tree. Idempotent — repeated calls return the existing folder.
 */
async function ensureInstanceFolder(vault, docName) {
  const fId = await instanceFolderId(vault, docName);
  const existing = game.folders.get(fId);
  const name = vault.rootFolder || vault.label || "Vault";
  if (existing) {
    if (existing.name !== name) {
      try { await existing.update({ name }); }
      catch (err) { console.warn(`Vaults | could not rename ${docName} folder for ${vault.label}:`, err); }
    }
    return fId;
  }
  try {
    await Folder.create({ _id: fId, name, type: docName, folder: null }, { keepId: true });
    return fId;
  } catch (err) {
    console.warn(`Vaults | could not create ${docName} folder for ${vault.label}:`, err);
    return null;
  }
}

async function buildOverlay(vault, vaultPath, meta, docName) {
  const overlay = {
    // Prefer the page's frontmatter `title:` over the filename — the wiki
    // already treats title as the page's display name, and a doc named
    // "Potion of Healing (Mossfoot Brew)" reads better in the Foundry
    // sidebar than "Healing Potion".
    name: meta.title || baseName(vaultPath),
    folder: await ensureInstanceFolder(vault, docName),
    flags: { [MODULE_ID]: { vaultId: vault.id, path: vaultPath } },
  };

  if (meta.image) {
    const localImg = imageUrlFromMeta(vault.id, meta.image);
    if (localImg) {
      overlay.img = localImg;
      // Actors carry a separate prototypeToken texture used when dragging
      // onto a scene. Keep it in sync so the cloned NPC's token portrait
      // matches the page's cover.
      if (docName === "Actor") setPath(overlay, "prototypeToken.texture.src", localImg);
    }
  }

  // Embed the page's JournalEntryPage into the document description so the
  // wiki article shows up inline on the doc sheet. Skipped silently when
  // the system isn't in the supported table — clone still happens. Pages
  // can opt out with `foundry: { embed: false }` (e.g. stats-only pages,
  // or DM-private pages where embedding would leak content into the
  // actor sheet). Default is true.
  const fm = meta?.foundry;
  const descPath = DESCRIPTION_FIELDS[game.system.id]?.[docName];
  const embedAuto = fm?.embed !== false;
  if (descPath && embedAuto) {
    const eId = await entryId(vault.id, vaultPath);
    const pId = await pageId(vault.id, vaultPath);
    setPath(overlay, descPath, `<p>@Embed[JournalEntry.${eId}.JournalEntryPage.${pId} inline]</p>`);
  }

  // User overrides win. Deep-merge so e.g. `foundry: { data: { system: {
  // attributes: { hp: { value: 45 } } } } }` patches just that leaf
  // without clobbering sibling keys we set above. The clone-and-rewrite
  // step expands `@vault/PATH` references in any string field down to the
  // local cache URL so authors can point Scene textures / Playlist sounds
  // at vault-shipped media without hand-writing the deploy URL.
  if (fm?.data && typeof fm.data === "object") {
    deepMerge(overlay, rewriteVaultPaths(structuredClone(fm.data), vault.id));
  }
  return overlay;
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
  return localImageUrl(vaultId, vaultPath);
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
