// Reskin an existing Foundry document (Actor / Item / etc.) with data from a
// vault page. The page itself still becomes a JournalEntryPage on the normal
// path; this module fires after that, taking the page's name + cover image
// and embedding the journal page back into the target document's description.
//
// Triggered by `foundry_base: <UUID>` in page frontmatter (validated CLI-side
// and shipped via _manifest.json `meta`). A nested `foundry:` block in the
// same frontmatter deep-merges into the document update so users can override
// system fields (HP, etc.) without us knowing the system schema.

import { entryId, pageId } from "./ids.mjs";
import { localImageUrl } from "./media.mjs";

// Where the rendered article HTML lands inside each system's document. Keyed
// by (game.system.id, document name). Add a row here to support a new system;
// missing entries fall back to a warning rather than guessing. Paths are
// relative to the document (so `system.details.biography.value`, not the full
// flat key).
const DESCRIPTION_FIELDS = {
  dnd5e: {
    Actor: "system.details.biography.value",
    Item: "system.description.value",
  },
};

/**
 * Apply page-driven updates to the document referenced by sidecar.foundry_base.
 * No-ops (and warns) on unsupported systems / missing UUIDs / unknown document
 * types. Idempotent: every call sets the same canonical fields, so re-running
 * sync converges.
 */
export async function applyReskin(vault, vaultPath, meta) {
  const uuid = meta.foundry_base;
  if (!uuid) return;

  const target = await safeFromUuid(uuid);
  if (!target) {
    console.warn(`Vaults | reskin: ${vaultPath} → ${uuid} did not resolve; skipping.`);
    return;
  }

  const fields = DESCRIPTION_FIELDS[game.system.id];
  const descPath = fields?.[target.documentName];
  if (!descPath) {
    console.warn(
      `Vaults | reskin: system "${game.system.id}" ${target.documentName} `
      + `not in supported reskin table; skipping ${vaultPath}.`,
    );
    return;
  }

  const pageName = baseName(vaultPath);
  const eId = await entryId(vault.id, vaultPath);
  const pId = await pageId(vault.id, vaultPath);

  // Foundry's @Embed enricher renders the JournalEntryPage's HTML inline
  // when the document description is shown. The wrapper paragraph keeps it
  // playing nicely with editors that strip bare enrichers on save.
  const embedHtml = `<p>@Embed[JournalEntry.${eId}.JournalEntryPage.${pId} inline]</p>`;

  const update = setPath({}, descPath, embedHtml);
  update.name = pageName;

  if (meta.image) {
    const localImg = imageUrlFromMeta(vault.id, meta.image);
    if (localImg) {
      update.img = localImg;
      // Actors carry a separate prototypeToken texture used when dragging
      // onto a scene. Keep it in sync with img so a freshly reskinned NPC
      // doesn't drop its old portrait into the canvas.
      if (target.documentName === "Actor") {
        setPath(update, "prototypeToken.texture.src", localImg);
      }
    }
  }

  // User overrides win. Deep-merge so e.g. `foundry: { system: { attributes:
  // { hp: { value: 45 } } } }` patches just that leaf without clobbering
  // the description we just set.
  if (meta.foundry && typeof meta.foundry === "object") {
    deepMerge(update, meta.foundry);
  }

  try {
    await target.update(update);
  } catch (err) {
    console.warn(`Vaults | reskin update failed for ${vaultPath} → ${uuid}:`, err);
  }
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
 * `/attachments/foo.webp`, or an http(s) URL for external images) into the
 * Foundry-served path under the local image cache. External URLs pass
 * through unchanged.
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
