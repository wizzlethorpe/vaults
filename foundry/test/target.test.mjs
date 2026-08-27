// The adventure target: one Adventure document assembled from many pages.
//
// The property that matters is incremental assembly. A sync only visits the
// pages that changed, but the Adventure has to come out holding every page the
// vault has — so it is seeded from what is already in the pack and patched,
// not rebuilt. Get that wrong and the second sync ships an adventure
// containing only whatever happened to change that day.

import test from "node:test";
import assert from "node:assert/strict";

import { openTarget } from "../scripts/target.mjs";
import { isAdventure, uuidPrefix } from "../scripts/packs.mjs";

const VAULT = { id: "marlo-4ec31e8c", label: "Marlo Mystery", url: "https://v.example",
                foundryPackage: "adventure" };

/**
 * A world holding one Adventure pack. `source` is the adventure already in it,
 * or null for a vault that has never synced. Its `_id` is filled in with the
 * derived one, because that is what the target looks for.
 */
async function withWorld(source, fn) {
  const { adventureId } = await import("../scripts/ids.mjs");
  const id = await adventureId(VAULT.id);
  const prev = { game: globalThis.game, Adventure: globalThis.Adventure };
  const state = { created: null, updated: null };
  let current = source ? { ...source, _id: id } : null;
  const asDoc = (data) => ({
    toObject: () => structuredClone(data),
    update: async (d) => { state.updated = d; },
  });
  const pack = {
    collection: `world.${VAULT.id}-adventure`, locked: false, documentName: "Adventure",
    config: { ownership: { GAMEMASTER: "OWNER", ASSISTANT: "OWNER", TRUSTED: "NONE", PLAYER: "NONE" } },
    folders: new Map(),
    getDocument: async (wanted) => (current && wanted === current._id ? asDoc(current) : null),
    configure: async () => {},
  };
  globalThis.game = { packs: new Map([[pack.collection, pack]]) };
  globalThis.Adventure = { create: async (d) => { state.created = d; current = d; } };
  try { return await fn(state); }
  finally {
    globalThis.game = prev.game;
    globalThis.Adventure = prev.Adventure;
  }
}

test("an adventure vault addresses its documents as world documents", () => {
  // The whole point. A compendium UUID would keep pointing at the pack copy
  // after import, so every link in an imported adventure would lead back out
  // of the world to a second copy of the thing beside it.
  assert.equal(uuidPrefix(VAULT, "Actor"), "");
  assert.equal(uuidPrefix({ ...VAULT, foundryPackage: "compendium" }, "Actor"),
    `Compendium.world.${VAULT.id}-actors.`);
  assert.ok(isAdventure(VAULT));
});

test("a first sync creates the Adventure with what it was given", async () => {
  await withWorld(null, async (state) => {
    const t = await openTarget(VAULT);
    await t.put("JournalEntry", { _id: "e1", name: "Lore", pages: [{ _id: "p1" }] });
    await t.put("Actor", { _id: "a1", name: "Beefy" });
    await t.putFolder("JournalEntry", { _id: "f1", name: "Lore", folder: null });
    await t.commit();

    assert.equal(state.created.journal.length, 1);
    assert.equal(state.created.actors.length, 1);
    assert.equal(state.created.folders[0].type, "JournalEntry");
    // Every field the schema names, so an empty one is an empty array rather
    // than absent — an Adventure missing `scenes` is not the same document.
    for (const f of ["journal", "actors", "items", "scenes", "tables", "macros", "cards", "playlists"]) {
      assert.ok(Array.isArray(state.created[f]), `${f} should be an array`);
    }
  });
});

test("an incremental sync keeps the pages it did not touch", async () => {
  // The failure this exists to catch: seeding from nothing and committing only
  // the changed page, leaving an adventure with one entry in it.
  const source = {
    _id: "adv1", name: "Marlo Mystery",
    journal: [{ _id: "e1", name: "Lore", pages: [{ _id: "p1" }] },
              { _id: "e2", name: "Places", pages: [{ _id: "p2" }] }],
    actors: [{ _id: "a1", name: "Beefy" }],
    folders: [{ _id: "f1", name: "Lore", type: "JournalEntry", folder: null }],
  };
  await withWorld(source, async (state) => {
    const t = await openTarget(VAULT);
    await t.put("JournalEntry", { _id: "e2", name: "Places", pages: [{ _id: "p2", name: "new" }] });
    await t.commit();

    const ids = state.updated.journal.map((e) => e._id).sort();
    assert.deepEqual(ids, ["e1", "e2"], "the untouched entry must survive");
    assert.equal(state.updated.actors.length, 1, "so must documents of other types");
    assert.equal(state.updated.folders.length, 1);
    assert.equal(state.updated.journal.find((e) => e._id === "e2").pages[0].name, "new");
  });
});

test("a removed page is dropped from the adventure", async () => {
  const source = { _id: "adv1", journal: [{ _id: "e1" }, { _id: "e2" }], actors: [] };
  await withWorld(source, async (state) => {
    const t = await openTarget(VAULT);
    await t.remove("JournalEntry", "e1");
    await t.commit();
    assert.deepEqual(state.updated.journal.map((e) => e._id), ["e2"]);
  });
});

test("a sync that changed nothing does not rewrite the adventure", async () => {
  // It is one document holding the whole vault, so an idempotent sync
  // rewriting it would be the most expensive no-op in the module.
  const source = { _id: "adv1", journal: [{ _id: "e1" }], actors: [] };
  await withWorld(source, async (state) => {
    const t = await openTarget(VAULT);
    await t.commit();
    assert.equal(state.updated, null);
  });
});

test("reading back what was staged sees the staged version", async () => {
  // applyInstance reads the existing document to decide what to patch, and in
  // adventure mode nothing has been written yet when it asks.
  const source = { _id: "adv1", journal: [], actors: [{ _id: "a1", name: "Old" }] };
  await withWorld(source, async () => {
    const t = await openTarget(VAULT);
    assert.equal((await t.get("Actor", "a1")).name, "Old");
    await t.put("Actor", { _id: "a1", name: "New" });
    assert.equal((await t.get("Actor", "a1")).name, "New");
    assert.deepEqual([...(await t.ids("Actor"))], ["a1"]);
  });
});

test("a document type an Adventure cannot hold is refused, not dropped", async () => {
  await withWorld(null, async () => {
    const t = await openTarget(VAULT);
    await assert.rejects(() => t.put("ActiveEffect", { _id: "x" }), /cannot hold/);
  });
});

// ── scene thumbnails ────────────────────────────────────────────────────────

test("a scene's background is found in either shape of the field", async () => {
  // v14 moved it onto the Level. A vault can supply either, because
  // foundry.data is passed through and shared scene JSON is often older, and
  // reading only one shape means no thumbnail for half of them.
  const { sceneBackgroundSrc } = await import("../scripts/instance.mjs");

  assert.equal(sceneBackgroundSrc({ background: { src: "old.webp" } }), "old.webp");
  assert.equal(sceneBackgroundSrc({ levels: [{ _id: "l1", background: { src: "new.webp" } }] }),
    "new.webp");
  // A multi-level scene is thumbnailed from the level it opens on.
  assert.equal(sceneBackgroundSrc({
    initialLevel: "l2",
    levels: [{ _id: "l1", background: { src: "ground.webp" } },
             { _id: "l2", background: { src: "roof.webp" } }],
  }), "roof.webp");
  assert.equal(sceneBackgroundSrc({}), null);
  assert.equal(sceneBackgroundSrc({ levels: [] }), null);
});
