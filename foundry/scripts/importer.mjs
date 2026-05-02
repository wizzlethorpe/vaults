// Create / update / delete Foundry JournalEntry + JournalEntryPage from
// vault-rendered HTML.

import { MODULE_ID, SETTINGS, get } from "./settings.mjs";
import { entryId, pageId, folderId } from "./ids.mjs";
import { transformHtmlForFoundry } from "./links.mjs";

/**
 * Ensure a chain of nested Foundry folders exists matching the vault's
 * directory hierarchy. Returns the deepest folder's id.
 */
export async function ensureFolderChain(segments) {
  const rootName = get(SETTINGS.rootFolder) || "Vault";
  const rootKey = `__root__/${rootName}`;
  const rootFId = await folderId(rootKey);
  await upsertFolder(rootFId, rootName, null);

  let parentId = rootFId;
  let acc = rootKey;
  for (const seg of segments) {
    acc += "/" + seg;
    const fId = await folderId(acc);
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
export async function upsertFile(path, body, index) {
  const html = await transformHtmlForFoundry(body, index);

  const segs = path.split("/");
  const filename = segs.pop();
  const title = filename.replace(/\.md$/i, "");
  const folder = await ensureFolderChain(segs);

  const eId = await entryId(path);
  const pId = await pageId(path);

  const pageData = {
    _id: pId,
    name: title,
    type: "text",
    text: { content: html, format: 1 /* HTML */ },
    flags: { [MODULE_ID]: { path } },
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
    flags: { [MODULE_ID]: { path } },
  }, { keepId: true });
  return "added";
}

/** Delete the journal corresponding to a vault path. */
export async function deleteFile(path) {
  const eId = await entryId(path);
  const entry = game.journal.get(eId);
  if (entry) await entry.delete();
}
