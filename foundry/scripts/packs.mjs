// The compendium packs a vault syncs into, and the sidebar folder that
// groups them.
//
// Vault content lands in world-level compendium packs rather than directly
// in the world. The GM decides what to bring across and when, which is the
// point: a sync no longer writes into the documents someone is running a
// game with, so it can always overwrite its own packs without asking whether
// the GM has since edited something.
//
// Packs are GM-only, and that is a property of the format rather than a
// setting we chose. Compendium visibility is per *pack*, keyed by Foundry
// user role — `CompendiumCollection#_getVisibleTreeContents` returns the
// whole index with no per-document filter — so a pack a player can open is a
// pack where every name and image in it is visible to them. Per-page roles
// cannot be expressed at that granularity, so they are not expressed at all
// here: documents carry their `ownership` into the pack, Foundry's Import All
// preserves it (`clearOwnership: false`), and the per-page tiers take effect
// in the world where Foundry can actually enforce them.
//
// A new world pack needs no configuration to get this: `ownership` defaults
// to PLAYER: INHERIT, which resolves to NONE, and `locked` defaults to false
// for world packs.

import { PACK_KEY } from "./foundry-base.mjs";

/** The pack name (without the "world." scope) a vault's `docName` lands in. */
export function packName(vault, docName) {
  const key = PACK_KEY[docName];
  if (!key) return null;
  // vault.id is already a slug ("seylon-wiki-71c13dcb"), so it needs no
  // further munging to be a legal pack name.
  return `${vault.id}-${key}`;
}

/** The fully-scoped collection id, e.g. "world.seylon-wiki-71c13dcb-journal". */
export function packCollection(vault, docName) {
  const name = packName(vault, docName);
  return name ? `world.${name}` : null;
}

/**
 * The UUID of a page's journal page inside the vault's journal pack.
 *
 * Every wikilink, every "Open in Foundry" footer link and every description
 * embed spells one of these out. They were three separate template literals
 * until one definition replaced them: the same shape written in three places
 * is how `foundry.base` ended up parsed five different ways, with the copies
 * disagreeing and inbound links silently dying.
 */
export function journalPageUuid(vault, entryId, pageId) {
  return `Compendium.${packCollection(vault, "JournalEntry")}`
    + `.JournalEntry.${entryId}.JournalEntryPage.${pageId}`;
}

/** The UUID of the document a page instantiates, inside that type's pack. */
export function instanceUuid(vault, docName, id) {
  return `Compendium.${packCollection(vault, docName)}.${docName}.${id}`;
}

/** The vault's pack for `docName` if it exists, else null. Never creates. */
export function getPack(vault, docName) {
  const collection = packCollection(vault, docName);
  return collection ? game.packs.get(collection) ?? null : null;
}

/** Every pack belonging to `vault` that currently exists. */
export function vaultPacks(vault) {
  return Object.keys(PACK_KEY)
    .map((docName) => getPack(vault, docName))
    .filter((pack) => pack !== null);
}

/**
 * Delete every pack a vault owns, used when the vault is removed from the
 * registry.
 *
 * This used to be two functions walking the world for documents carrying our
 * flag, and then guessing which empty Folders had been ours by re-deriving
 * their ids — folders carry no flag, so whatever could not be proven ours was
 * left behind. A pack is unambiguously ours, and its folders go with it.
 *
 * Anything the GM imported into their world stays. That is the point of
 * importing: those are their documents now, not the vault's.
 */
export async function deleteVaultPacks(vaultId) {
  for (const pack of vaultPacks({ id: vaultId })) {
    try { await pack.deleteCompendium(); }
    catch (err) { console.warn(`Vaults | failed to delete pack ${pack.collection}:`, err); }
  }
}

// Creating a pack is a socket round-trip, so two overlapping calls for the
// same pack would both see it missing and both ask the server to make it.
// Sync is sequential today; this keeps that from being load-bearing.
const inFlight = new Map();

/**
 * The vault's pack for `docName`, created if it does not exist yet.
 *
 * Throws rather than returning null when the pack is locked: a locked pack
 * rejects every write, and the alternative is a sync that reports several
 * hundred individually failed pages for one cause the GM can fix in a click.
 */
export async function ensurePack(vault, docName) {
  const collection = packCollection(vault, docName);
  if (!collection) throw new Error(`No pack is defined for ${docName} documents`);

  const existing = game.packs.get(collection);
  if (existing) {
    assertWritable(existing, vault);
    return existing;
  }

  const pending = inFlight.get(collection);
  if (pending) return pending;

  const promise = createPack(vault, docName, collection).finally(() => inFlight.delete(collection));
  inFlight.set(collection, promise);
  return promise;
}

async function createPack(vault, docName, collection) {
  const label = `${vault.label || "Vault"}: ${LABEL[docName] ?? docName}`;
  // The namespaced path, not the bare `CompendiumCollection` global: v14 moved
  // the collection classes under foundry.documents.collections and kept the
  // old names only in its deprecated-globals table, which warns on every use.
  // The document classes (Folder, JournalEntry) did not move.
  await foundry.documents.collections.CompendiumCollection.createCompendium({
    type: docName,
    label,
    name: packName(vault, docName),
    packageType: "world",
  });
  const pack = game.packs.get(collection);
  // createCompendium resolves through a socket response and reports a refusal
  // to the GM rather than throwing, so a missing pack here is a real outcome
  // and not a race.
  if (!pack) throw new Error(`Compendium pack ${collection} was not created`);
  await pack.setFolder(await ensurePackFolder(vault));
  assertWritable(pack, vault);
  return pack;
}

function assertWritable(pack, vault) {
  if (!pack.locked) return;
  throw new Error(
    `Compendium pack ${pack.collection} is locked. Unlock it in the sidebar `
    + `to let ${vault.label || "this vault"} sync into it.`,
  );
}

/**
 * The Compendium-type Folder a vault's packs sit in, created on first use.
 *
 * Grouping them matters more here than it would for one pack: a vault with
 * scenes, actors, items and journals contributes several packs, and without a
 * folder they scatter alphabetically through a sidebar that already lists
 * every system and module pack.
 */
async function ensurePackFolder(vault) {
  const name = vault.rootFolder || vault.label || "Vault";
  const existing = game.folders.find((f) => f.type === "Compendium" && f.name === name);
  if (existing) return existing;
  return Folder.create({ name, type: "Compendium" });
}

// Sidebar labels. The pack key is a slug and the document name is jargon;
// neither reads well as the thing a GM scans for in a sidebar.
const LABEL = {
  Actor: "Actors",
  Item: "Items",
  Scene: "Scenes",
  JournalEntry: "Journals",
  RollTable: "Roll Tables",
  Macro: "Macros",
  Cards: "Cards",
  Playlist: "Playlists",
};
