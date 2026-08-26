// Golden values for the deterministic id scheme.
//
// These ids are written into every synced world: journal entries, journal
// pages, folders, instantiated Actors/Items, and embedded sub-documents all
// address each other by them, and `flags.vaults` records them. Change the
// digest, the "vaults:" prefix, any <kind> string, or the 16-char truncation
// and every existing world's documents orphan — the next sync creates a full
// duplicate set beside them and nothing warns, because from the module's side
// the new ids simply aren't there yet.
//
// That is not recoverable by the user, so the scheme is pinned here. If one
// of these fails, the question is not "update the expectation" but "does this
// need a manifest id_scheme bump and a forced re-sync".

import { test } from "node:test";
import assert from "node:assert/strict";

import { entryId, pageId, folderId, instanceId, subdocId, folderOfPath } from "../scripts/ids.mjs";

const VAULT = "4ec31e8cb283";           // a real vault id, from a live world
const PATH = "Creatures/Beefy.md";

test("instanceId matches the id in a live world", async () => {
  // Verified against Southaven: Creatures/Beefy.md instantiates
  // Actor.daef7567b4c62dda in the world synced from vault 4ec31e8cb283.
  assert.equal(await instanceId(VAULT, PATH), "daef7567b4c62dda");
});

test("entryId is folder-keyed, so siblings share one journal entry", async () => {
  const a = await entryId(VAULT, "Creatures/Beefy.md");
  const b = await entryId(VAULT, "Creatures/Sandwalker.md");
  assert.equal(a, b, "same folder must share an entry id");
  const other = await entryId(VAULT, "NPCs/Aelar.md");
  assert.notEqual(a, other, "a different folder must not");
});

test("golden ids for every kind", async () => {
  assert.deepEqual(
    {
      entry: await entryId(VAULT, PATH),
      page: await pageId(VAULT, PATH),
      folder: await folderId(VAULT, "Creatures"),
      instance: await instanceId(VAULT, PATH),
      subdoc: await subdocId(VAULT, PATH, "/walls/3"),
    },
    {
      entry: "51455198af3801be",
      page: "991419f8434d31f4",
      folder: "9603ef8c0836bf86",
      instance: "daef7567b4c62dda",
      subdoc: "11b328a0b6f750a4",
    },
  );
});

test("ids are 16 chars and legal Foundry ids", async () => {
  for (const id of [
    await entryId(VAULT, PATH), await pageId(VAULT, PATH),
    await folderId(VAULT, "Creatures"), await instanceId(VAULT, PATH),
    await subdocId(VAULT, PATH, "/walls/3"),
  ]) {
    assert.match(id, /^[A-Za-z0-9]{16}$/);
  }
});

test("each kind is namespaced, so the same key can't collide across kinds", async () => {
  const ids = new Set([
    await entryId(VAULT, PATH), await pageId(VAULT, PATH),
    await folderId(VAULT, PATH), await instanceId(VAULT, PATH),
  ]);
  assert.equal(ids.size, 4);
});

test("the vault id is part of the key, so two vaults never collide", async () => {
  assert.notEqual(await pageId("aaaaaaaaaaaa", PATH), await pageId("bbbbbbbbbbbb", PATH));
});

test("folderOfPath strips the basename", () => {
  assert.equal(folderOfPath("Creatures/Beefy.md"), "Creatures");
  assert.equal(folderOfPath("A/B/C.md"), "A/B");
  assert.equal(folderOfPath("Top.md"), "", "root-level files have no folder");
});
