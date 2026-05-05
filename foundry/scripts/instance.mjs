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

const SUPPORTED_DOCS = new Set(["Actor", "Item"]);

/**
 * Instantiate (or update) the document a vault page owns. No-op when there's
 * no foundry_base. Idempotent: re-running with unchanged inputs converges.
 */
export async function applyInstance(vault, vaultPath, meta) {
  const uuid = meta.foundry_base;
  if (!uuid) return;

  const template = await safeFromUuid(uuid);
  if (!template) {
    console.warn(`Vaults | foundry_base: ${vaultPath} → ${uuid} did not resolve; skipping.`);
    return;
  }
  const docName = template.documentName;
  if (!SUPPORTED_DOCS.has(docName)) {
    console.warn(
      `Vaults | foundry_base: ${vaultPath} → ${uuid} is a ${docName}; `
      + `only Actor and Item are supported.`,
    );
    return;
  }

  const collection = docName === "Actor" ? game.actors : game.items;
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

  // Fresh clone: copy the template's source data, swap in our deterministic id,
  // then deep-merge the overlay so the new doc is born already customised.
  // toObject() works on both compendium-loaded and world docs; pack-locking
  // doesn't apply because we're creating a brand-new world document.
  let data;
  try { data = template.toObject(); }
  catch (err) {
    console.warn(`Vaults | foundry_base: could not read template ${uuid}:`, err);
    return;
  }
  delete data._id;
  data._id = id;
  deepMerge(data, overlay);

  try {
    await docClass.create(data, { keepId: true });
  } catch (err) {
    console.warn(`Vaults | foundry_base create failed for ${vaultPath}:`, err);
  }
}

/**
 * Delete the derived document for a deleted page. Best-effort: only acts when
 * the doc carries our vault flag, so we don't yank a doc the user took over
 * by hand.
 */
export async function deleteInstance(vault, vaultPath) {
  const id = await instanceId(vault.id, vaultPath);
  for (const collection of [game.actors, game.items]) {
    const doc = collection.get(id);
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
  // the system isn't in the supported table — clone still happens.
  const descPath = DESCRIPTION_FIELDS[game.system.id]?.[docName];
  if (descPath) {
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
