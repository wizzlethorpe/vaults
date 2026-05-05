// Create / update / delete Foundry JournalEntry + JournalEntryPage from
// vault-rendered HTML. Every document carries flags.vaults.{vaultId,path}
// so a single world can host multiple vaults without conflict.

import { MODULE_ID } from "./settings.mjs";
import { entryId, pageId, folderId } from "./ids.mjs";
import { transformHtmlForFoundry } from "./links.mjs";

/**
 * Ensure a chain of nested Foundry folders exists matching the vault's
 * directory hierarchy under the vault's configured root folder. Returns
 * the deepest folder's id.
 */
async function ensureFolderChain(vault, segments) {
  const rootName = vault.rootFolder || vault.label || "Vault";
  const rootKey = `${vault.id}/__root__/${rootName}`;
  const rootFId = await folderId(vault.id, rootKey);
  await upsertFolder(rootFId, rootName, null);

  let parentId = rootFId;
  let acc = rootKey;
  for (const seg of segments) {
    acc += "/" + seg;
    const fId = await folderId(vault.id, acc);
    await upsertFolder(fId, seg, parentId);
    parentId = fId;
  }
  return parentId;
}

async function upsertFolder(id, name, parentId) {
  const existing = game.folders.get(id);
  if (existing) {
    if (existing.name !== name || existing.folder?.id !== parentId) {
      await existing.update({ name, folder: parentId });
    }
    return existing;
  }
  return Folder.create({ _id: id, name, type: "JournalEntry", folder: parentId }, { keepId: true });
}

/**
 * Import (create or update) a single page. `path` is the logical .md path
 * (used for stable ids + folder structure); `body` is the rendered article
 * HTML straight from the vault's <page>.body.html. `meta` is the manifest's
 * per-page entry (carries the page's role for the dmRole permission gate).
 */
export async function upsertFile(vault, path, body, index, meta) {
  const html = await transformHtmlForFoundry(vault, body, index, meta?.role);

  const segs = path.split("/");
  const filename = segs.pop();
  // Prefer the page's frontmatter `title:` (passed via meta) over the
  // filename basename so the Foundry sidebar shows the same display name
  // as the wiki's page header.
  const title = meta?.title || filename.replace(/\.md$/i, "");
  const folder = await ensureFolderChain(vault, segs);

  const eId = await entryId(vault.id, path);
  const pId = await pageId(vault.id, path);

  const flags = { [MODULE_ID]: { vaultId: vault.id, path } };
  const pageData = {
    _id: pId,
    name: title,
    type: "text",
    text: { content: html, format: 1 /* HTML */ },
    flags,
  };

  const ownershipPatch = ownershipFor(vault, meta?.role);

  const existing = game.journal.get(eId);
  if (existing) {
    const entryPatch = {};
    if (existing.name !== title) entryPatch.name = title;
    if (existing.folder?.id !== folder) entryPatch.folder = folder;
    // Only push ownership when the page tier moved across the dmRole cutoff.
    // Avoids stomping over manual ownership tweaks the GM made on individual
    // entries during regular re-syncs.
    if (ownershipPatch && existing.ownership?.default !== ownershipPatch.default) {
      entryPatch.ownership = ownershipPatch;
    }
    if (Object.keys(entryPatch).length > 0) await existing.update(entryPatch);

    const existingPage = existing.pages.get(pId);
    if (existingPage) await existingPage.update(pageData);
    else await existing.createEmbeddedDocuments("JournalEntryPage", [pageData], { keepId: true });
    return "modified";
  }

  await JournalEntry.create({
    _id: eId,
    name: title,
    folder,
    pages: [pageData],
    flags,
    ...(ownershipPatch ? { ownership: ownershipPatch } : {}),
  }, { keepId: true });
  return "added";
}

/**
 * Map a page's role tier to a JournalEntry ownership stanza, given the
 * vault's configured dmRole. Returns null when no gating is configured;
 * callers fall back to Foundry's default (GM-only) in that case.
 *
 * Ranks come straight from vault.knownRoles (lowest → highest, as reported
 * by the deploy manifest). Rank below dmRole → OBSERVER for everyone; rank
 * at-or-above dmRole → no override (so the entry remains GM-only).
 */
function ownershipFor(vault, pageRole) {
  if (!vault.dmRole || !vault.knownRoles?.length) return null;
  const dmIdx = vault.knownRoles.indexOf(vault.dmRole);
  if (dmIdx < 0) return null;
  const pageIdx = pageRole ? vault.knownRoles.indexOf(pageRole) : -1;
  // Unknown / missing page role: treat as the lowest tier so the page lands
  // player-visible. Conservative the other way (default to GM-only) would
  // hide pages from older deploys whose manifest predates the role field.
  const effectiveIdx = pageIdx < 0 ? 0 : pageIdx;
  if (effectiveIdx < dmIdx) {
    return { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  }
  return null;
}

/** Delete the journal corresponding to a vault path. */
export async function deleteFile(vault, path) {
  const eId = await entryId(vault.id, path);
  const entry = game.journal.get(eId);
  if (entry) await entry.delete();
}

/**
 * Wipe every JournalEntry / Folder belonging to a given vault. Used when
 * the user removes a vault from the registry.
 */
export async function deleteVaultJournals(vaultId) {
  const journals = game.journal.contents.filter((j) => j.getFlag(MODULE_ID, "vaultId") === vaultId);
  for (const j of journals) await j.delete();
  // Folders don't carry the flag; they're identified by deterministic id.
  // We can't enumerate all of a vault's folders without walking, so just
  // delete the root folder if it's empty after journal removal.
  const folders = game.folders.contents.filter((f) => f.type === "JournalEntry");
  for (const f of folders.reverse()) {
    if (f.contents.length === 0 && f.children.length === 0) {
      // Conservative: only remove if it looks like it belonged to this vault
      // (root folder id is deterministic from vault id).
      const root = await folderId(vaultId, `${vaultId}/__root__/${f.name}`);
      if (f.id === root) await f.delete();
    }
  }
}
