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
 * HTML straight from the vault's <page>.body.html.
 */
export async function upsertFile(vault, path, body, index) {
  const html = await transformHtmlForFoundry(vault.id, body, index);

  const segs = path.split("/");
  const filename = segs.pop();
  const title = filename.replace(/\.md$/i, "");
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

  const existing = game.journal.get(eId);
  if (existing) {
    if (existing.name !== title || existing.folder?.id !== folder) {
      await existing.update({ name: title, folder });
    }
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
  }, { keepId: true });
  return "added";
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
