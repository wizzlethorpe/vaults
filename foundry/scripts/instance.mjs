// Instantiate a world-level Foundry document (Actor / Item) from a vault page.
// `foundry_base: <UUID>` in page frontmatter names a template — usually an SRD
// compendium doc, but a world-level doc works too. We clone the template into
// the world under a deterministic id derived from (vault.id, path), then layer
// on the page's name + cover image + an `@Embed[…]` of the page's journal so
// the document description always shows the rendered article.
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

import { entryId, pageId, instanceId } from "./ids.mjs";
import { localImageUrl } from "./media.mjs";
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

// Document types supported by `foundry_base: <UUID>` (clone-from-template).
// Cloning needs a description-embed path, so this stays the narrow set.
const CLONE_SUPPORTED_DOCS = new Set(["Actor", "Item"]);

// Document types supported by `foundry_base: <type>[:<subtype>]` (blank doc).
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
 * no foundry_base. Idempotent: re-running with unchanged inputs converges.
 *
 * `foundry_base` accepts two forms:
 *   - **UUID** (`Compendium.dnd5e.monsters.Actor.O3ABqI55Ir1du1Xa`,
 *     `Actor.abc123`, …): clone the named template into the world.
 *   - **Type[:subtype]** (`Actor:npc`, `Item:weapon`, `Scene`, …): create a
 *     blank document of that type. The `foundry:` frontmatter overlay then
 *     populates fields. Useful when no template exists in any compendium —
 *     pure homebrew or bespoke maps/macros/decks.
 */
export async function applyInstance(vault, vaultPath, meta) {
  const parsed = parseFoundryBase(meta.foundry_base);
  if (!parsed) return;

  let docName;
  let baseData;
  if (parsed.kind === "uuid") {
    const template = await safeFromUuid(parsed.uuid);
    if (!template) {
      console.warn(`Vaults | foundry_base: ${vaultPath} → ${parsed.uuid} did not resolve; skipping.`);
      return;
    }
    docName = template.documentName;
    if (!CLONE_SUPPORTED_DOCS.has(docName)) {
      console.warn(
        `Vaults | foundry_base: ${vaultPath} → ${parsed.uuid} is a ${docName}; `
        + `clone-from-UUID only supports ${[...CLONE_SUPPORTED_DOCS].join(", ")}.`,
      );
      return;
    }
    // toObject() works on both compendium-loaded and world docs; pack-locking
    // doesn't apply because we're creating a brand-new world document.
    try { baseData = template.toObject(); }
    catch (err) {
      console.warn(`Vaults | foundry_base: could not read template ${parsed.uuid}:`, err);
      return;
    }
    delete baseData._id;
  } else {
    docName = parsed.docName;
    baseData = parsed.subtype ? { type: parsed.subtype } : {};
  }

  const collection = COLLECTION_FOR[docName]?.();
  if (!collection) {
    console.warn(`Vaults | foundry_base: no world collection for ${docName}; skipping ${vaultPath}.`);
    return;
  }
  const docClass = CONFIG[docName].documentClass;
  const id = await instanceId(vault.id, vaultPath);

  const overlay = await buildOverlay(vault, vaultPath, meta, docName);

  const existing = collection.get(id);
  if (existing) {
    try {
      await existing.update(overlay);
    } catch (err) {
      console.warn(`Vaults | foundry_base update failed for ${vaultPath}:`, err);
    }
    return;
  }

  baseData._id = id;
  deepMerge(baseData, overlay);

  try {
    await docClass.create(baseData, { keepId: true });
  } catch (err) {
    console.warn(`Vaults | foundry_base create failed for ${vaultPath}:`, err);
  }
}

/**
 * Parse the `foundry_base` value into either a UUID-clone form or a
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

async function buildOverlay(vault, vaultPath, meta, docName) {
  const overlay = {
    // Prefer the page's frontmatter `title:` over the filename — the wiki
    // already treats title as the page's display name, and a doc named
    // "Potion of Healing (Mossfoot Brew)" reads better in the Foundry
    // sidebar than "Healing Potion".
    name: meta.title || baseName(vaultPath),
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
  // can opt out with `foundry_no_embed: true` (e.g. stats-only pages, or
  // DM-private pages where embedding would leak content into the actor sheet).
  const descPath = DESCRIPTION_FIELDS[game.system.id]?.[docName];
  if (descPath && !meta.foundry_no_embed) {
    const eId = await entryId(vault.id, vaultPath);
    const pId = await pageId(vault.id, vaultPath);
    setPath(overlay, descPath, `<p>@Embed[JournalEntry.${eId}.JournalEntryPage.${pId} inline]</p>`);
  }

  // User overrides win. Deep-merge so e.g. `foundry: { system: { attributes:
  // { hp: { value: 45 } } } }` patches just that leaf without clobbering
  // sibling keys we set above.
  if (meta.foundry && typeof meta.foundry === "object") {
    deepMerge(overlay, meta.foundry);
  }
  return overlay;
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
