// Where a sync puts the documents it builds.
//
// Two shapes, chosen by the vault's `foundry_package` setting:
//
//   compendium — one pack per document type, each document written on its own.
//                What a reference library wants: you browse it and take one
//                thing. Links name the packs, because the pack copy is the
//                copy and nothing is imported as a unit.
//
//   adventure  — one Adventure document holding everything. What a campaign
//                wants: imported once, as a whole. Links are *world* UUIDs,
//                because Foundry's Adventure import creates with keepId and
//                updates whatever already carries the id, so after import
//                every reference resolves to the copy the GM now owns. Point
//                them at the pack instead and each one leads back out of the
//                world to a second copy of the thing sitting beside it.
//
// Both are written into a compendium pack either way, so a sync still never
// touches a document someone is running a game with.
//
// The interface is deliberately data-in, data-out: `get` hands back plain
// document data and `put` takes the whole thing. An Adventure holds data, not
// documents, so anything richer would only be implementable on one side.

import { ensurePack, getPack, isAdventure } from "./packs.mjs";
import { adventureId } from "./ids.mjs";
import { MODULE_ID } from "./settings.mjs";

/** Open the sync target for a vault. Creates packs as needed. */
export async function openTarget(vault) {
  return isAdventure(vault) ? openAdventure(vault) : openCompendium(vault);
}

// ── compendium ──────────────────────────────────────────────────────────────

async function openCompendium(vault) {
  return {
    vault,
    adventure: false,

    async get(docName, id) {
      const pack = await ensurePack(vault, docName);
      const doc = await pack.getDocument(id);
      return doc ? doc.toObject() : null;
    },

    async put(docName, data) {
      const pack = await ensurePack(vault, docName);
      const existing = await pack.getDocument(data._id);
      if (existing) {
        await existing.update(data);
        return "modified";
      }
      const cls = CONFIG[docName].documentClass;
      await cls.create(data, { pack: pack.collection, keepId: true, keepEmbeddedIds: true });
      // A rejected document is reported to the GM and skipped rather than
      // thrown, so the promise resolves either way and the caller would count
      // a document that does not exist.
      if (!await pack.getDocument(data._id)) {
        throw new Error(`${docName} ${data._id} was rejected on create`);
      }
      return "added";
    },

    async remove(docName, id) {
      const pack = getPack(vault, docName);
      const doc = pack && await pack.getDocument(id);
      if (doc) await doc.delete();
    },

    async putFolder(docName, folder) {
      const pack = await ensurePack(vault, docName);
      const existing = pack.folders.get(folder._id);
      if (existing) {
        if (existing.name !== folder.name || (existing.folder?.id ?? null) !== (folder.folder ?? null)) {
          await existing.update({ name: folder.name, folder: folder.folder ?? null });
        }
        return;
      }
      await Folder.create(
        { ...folder, type: docName },
        { pack: pack.collection, keepId: true },
      );
      if (!pack.folders.get(folder._id)) {
        throw new Error(`Folder ${folder._id} ("${folder.name}") was rejected on create`);
      }
    },

    /** Every document of a type this vault owns. One request, not one per id. */
    async contents(docName) {
      const pack = getPack(vault, docName);
      return pack ? (await pack.getDocuments()).map((d) => d.toObject()) : [];
    },

    async ids(docName) {
      const pack = getPack(vault, docName);
      return new Set(pack ? (await pack.getIndex()).map((e) => e._id) : []);
    },

    // Each write already landed.
    async commit() {},
  };
}

// ── adventure ───────────────────────────────────────────────────────────────

// Adventure schema field per document type. `journal`, not `journals`.
const FIELD = {
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal",
  RollTable: "tables",
  Macro: "macros",
  Cards: "cards",
  Playlist: "playlists",
};

async function openAdventure(vault) {
  const pack = await ensurePack(vault, "Adventure");
  const id = await adventureId(vault.id);
  const existing = await pack.getDocument(id);
  const source = existing ? existing.toObject() : null;

  // The whole adventure is held in memory for the sync and written once. It is
  // a single document however many pages changed, so a per-page write would be
  // a full rewrite per page — and an incremental sync only visits the pages
  // that changed, so the untouched ones have to be carried across from what is
  // already there rather than rebuilt.
  const docs = new Map();      // docName -> Map(id -> data)
  for (const [docName, field] of Object.entries(FIELD)) {
    docs.set(docName, new Map((source?.[field] ?? []).map((d) => [d._id, d])));
  }
  const folders = new Map((source?.folders ?? []).map((f) => [f._id, f]));
  let dirty = false;

  return {
    vault,
    adventure: true,

    async get(docName, docId) {
      return docs.get(docName)?.get(docId) ?? null;
    },

    async put(docName, data) {
      const byId = docs.get(docName);
      if (!byId) throw new Error(`An Adventure cannot hold a ${docName}`);
      const had = byId.has(data._id);
      byId.set(data._id, data);
      dirty = true;
      return had ? "modified" : "added";
    },

    async remove(docName, docId) {
      if (docs.get(docName)?.delete(docId)) dirty = true;
    },

    async putFolder(docName, folder) {
      const want = { ...folder, type: docName, folder: folder.folder ?? null };
      const have = folders.get(folder._id);
      if (have && have.name === want.name && have.folder === want.folder) return;
      folders.set(folder._id, want);
      dirty = true;
    },

    async contents(docName) {
      return [...(docs.get(docName)?.values() ?? [])];
    },

    async ids(docName) {
      return new Set(docs.get(docName)?.keys() ?? []);
    },

    async commit() {
      if (!dirty && existing) return;
      const data = {
        _id: id,
        name: vault.label || "Vault",
        // The sheet shows these before import, and they are the only
        // description a GM gets of what they are about to bring in.
        caption: `Synced from ${vault.url}`,
        description: `<p>Every page, document and folder from the `
          + `<strong>${vault.label || "vault"}</strong> vault. Importing creates them in this `
          + `world; importing again updates what is already here rather than duplicating it.</p>`,
        folders: [...folders.values()],
        flags: { [MODULE_ID]: { vaultId: vault.id } },
      };
      for (const [docName, field] of Object.entries(FIELD)) {
        data[field] = [...docs.get(docName).values()];
      }
      if (existing) await existing.update(data);
      else {
        await Adventure.create(data, { pack: pack.collection, keepId: true, keepEmbeddedIds: true });
        if (!await pack.getDocument(id)) {
          throw new Error(`Adventure ${id} was rejected on create`);
        }
      }
    },
  };
}
