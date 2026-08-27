// Foundry-side tests. Only the helpers that touch no Foundry globals are
// reachable this way; anything calling Document.create / FilePicker / game.*
// still needs a mock layer that doesn't exist yet (see ROADMAP.md).
import { test } from "node:test";
import assert from "node:assert/strict";

import { missingBasePackages } from "../scripts/instance.mjs";
import { BLANK_DOC_TYPES, docNameFromBase, parseFoundryBase } from "../scripts/foundry-base.mjs";

test("parses a compendium UUID as a clone base", () => {
  const uuid = "Compendium.dnd5e.monsters.Actor.O3ABqI55Ir1du1Xa";
  assert.deepEqual(parseFoundryBase(uuid), { kind: "uuid", uuid });
});

test("parses a world-document UUID as a clone base", () => {
  assert.deepEqual(parseFoundryBase("Actor.abc123"), { kind: "uuid", uuid: "Actor.abc123" });
});

test("parses a bare type as a blank document", () => {
  assert.deepEqual(parseFoundryBase("Scene"), { kind: "blank", docName: "Scene", subtype: undefined });
});

test("parses type:subtype", () => {
  assert.deepEqual(parseFoundryBase("Item:weapon"), { kind: "blank", docName: "Item", subtype: "weapon" });
});

test("type matching is case-insensitive so lowercase YAML reads naturally", () => {
  assert.equal(parseFoundryBase("actor:npc")?.docName, "Actor");
});

test("returns null for an unknown type, so the caller can warn", () => {
  // A typo like this used to instantiate nothing, silently.
  assert.equal(parseFoundryBase("Actr:npc"), null);
});

test("returns null for non-string input", () => {
  // The priority-list syntax under discussion lands here until it's supported;
  // the caller must warn rather than no-op.
  assert.equal(parseFoundryBase(["Actor:npc"]), null);
  assert.equal(parseFoundryBase(undefined), null);
  assert.equal(parseFoundryBase(""), null);
});

// missingBasePackages touches `game`, so it needs the smallest possible stub.
// This is the seam where a fuller Foundry mock layer would start.
// missingBasePackages asks Foundry whether a pack answers, so the stub is a
// fromUuid built from a map of "pack you ask for" → "pack that answers". That
// shape is what lets a test express a *redirect*: dnd5e maps
// dnd-monster-manual.actors onto dnd5e.actors24, so asking for the former
// resolves even though that module is inactive, and the document that comes
// back carries the latter's uuid. A pack absent from the map does not resolve.
async function withPacks(packMap, fn) {
  const prevGame = globalThis.game;
  const prevFromUuid = globalThis.fromUuid;
  globalThis.game = { system: { id: "dnd5e" } };
  globalThis.fromUuid = async (uuid) => {
    const asked = uuid.split(".").slice(1, 3).join(".");
    const answers = packMap[asked];
    if (!answers) return null;
    return { documentName: "Actor", uuid: uuid.replace(asked, answers) };
  };
  // Must await: restoring the globals synchronously would pull fromUuid out
  // from under the probe loop after its first suspension.
  try { return await fn(); } finally { globalThis.game = prevGame; globalThis.fromUuid = prevFromUuid; }
}

const page = (base) => ({ foundry: { base } });

const MM = "dnd-monster-manual.actors";
const SYS = "dnd5e.actors24";
const mmGuard = "Compendium.dnd-monster-manual.actors.Actor.mmGuard000000000";
const sysGuard = "Compendium.dnd5e.actors24.Actor.mmGuard000000000";

test("reports a pack nothing can resolve, with a page count", async () => {
  await withPacks({}, async () => {
    assert.deepEqual([...await missingBasePackages([page(mmGuard), page(mmGuard)])],
      [["dnd-monster-manual", 2]]);
  });
});

test("a reachable pack is not missing", async () => {
  await withPacks({ [MM]: MM }, async () => {
    assert.equal((await missingBasePackages([page(mmGuard)])).size, 0);
  });
});

test("a pack reachable only by redirect is not reported missing", async () => {
  // dnd5e maps Compendium.dnd-monster-manual.actors onto Compendium.dnd5e.actors24,
  // so fromUuid answers for a module that is installed but disabled. The MM pack
  // is deliberately NOT itself in the map: it resolves purely via the redirect.
  // Inferring reachability from game.modules would call this missing.
  await withPacks({ [MM]: SYS }, async () => {
    assert.equal((await missingBasePackages([page(mmGuard)])).size, 0);
  });
});

test("a pack is only unreachable when every probed spec fails", async () => {
  // One stale document id shouldn't condemn a pack that other pages use fine,
  // so reachability probes several specs per pack before giving up.
  await withPacks({ [MM]: MM }, async () => {
    const stale = "Compendium.dnd-monster-manual.actors.Actor.staleaaaaaaaaaa1";
    const missing = await missingBasePackages([page(stale), page(mmGuard)]);
    assert.equal(missing.size, 0, "the second spec resolves, so the pack is reachable");
  });
});

test("blank and world-document bases are never reported", async () => {
  await withPacks({}, async () => {
    const missing = await missingBasePackages([
      page("Actor:npc"),
      page("Actor.abc1234567890123"),
      page("Compendium.world.my-pack.Actor.abc1234567890123"),
      page(undefined),
      {},
    ]);
    assert.equal(missing.size, 0);
  });
});

test("a list with a blank fallback can't strand the page", async () => {
  await withPacks({}, async () => {
    assert.equal((await missingBasePackages([page([mmGuard, "Actor:npc"])])).size, 0);
  });
});

test("a list is only stranded when every pack is unreachable", async () => {
  await withPacks({}, async () => {
    assert.deepEqual([...await missingBasePackages([page([mmGuard, sysGuard])])].sort(),
      [["dnd-monster-manual", 1], ["dnd5e", 1]]);
  });
  await withPacks({ [SYS]: SYS }, async () => {
    assert.equal((await missingBasePackages([page([mmGuard, sysGuard])])).size, 0,
      "the system pack answers, so nothing is stranded");
  });
});

// ── clone-from-UUID coverage ─────────────────────────────────────────────

test("the instantiable-type list covers every type a clone might name", () => {
  // Not a test of cloning itself — resolveBase needs fromUuid, a collection
  // and Document.create, none of which exist outside Foundry, so the create
  // path is still only verifiable against a live world. What this pins is the
  // list resolveBase gates on, which is what the restriction actually was:
  // cloning was limited to {Actor, Item} on the grounds that it needed a
  // description-embed path. It does not — buildOverlay skips the embed
  // silently when DESCRIPTION_FIELDS has no entry, which is already the
  // documented behaviour for an unsupported system. The narrow set only
  // blocked the useful cases, since map packs ship compendium Scenes.
  for (const t of ["Actor", "Item", "Scene", "RollTable", "Playlist", "Cards", "Macro", "JournalEntry"]) {
    assert.ok(BLANK_DOC_TYPES.includes(t), `${t} must be instantiable`);
  }
});

test("a compendium Scene UUID reads as a Scene", () => {
  // The shape that matters for composing an adventure from map packs.
  assert.equal(
    docNameFromBase("Compendium.mad-modcaverns.mad-modcaverns-maps.Scene.DiQAiq8wUMRGevDg"),
    "Scene",
  );
  assert.equal(docNameFromBase("Compendium.fa-battlemaps.maps.Scene.0M8gKipOIXQMqdEz"), "Scene");
});

// ── drift detection ──────────────────────────────────────────────────────

/**
 * Stub the world: `journals` and `docs` are the ids that exist. Mirrors what
 * findMissingDocuments actually reaches for — game.journal and the per-type
 * collections — and nothing else.
 */
async function withWorld({ journals = {}, actors = [] }, fn) {
  const prev = globalThis.game;
  globalThis.game = {
    journal: { get: (id) => (journals[id] ? { pages: { get: (p) => journals[id].includes(p) } } : undefined) },
    actors: { get: (id) => (actors.includes(id) ? { id } : undefined) },
    items: { get: () => undefined },
    scenes: { get: () => undefined },
  };
  try { return await fn(); } finally { globalThis.game = prev; }
}

const VAULT = { id: "4ec31e8cb283" };

test("a page whose journal and document both exist is not reported", async () => {
  const { entryId, pageId, instanceId } = await import("../scripts/ids.mjs");
  const { findMissingDocuments } = await import("../scripts/instance.mjs");
  const path = "Creatures/Beefy.md";
  const [e, p, i] = [await entryId(VAULT.id, path), await pageId(VAULT.id, path), await instanceId(VAULT.id, path)];
  await withWorld({ journals: { [e]: [p] }, actors: [i] }, async () => {
    const missing = await findMissingDocuments(VAULT, [{ logicalPath: path, meta: { foundry: { base: "Actor:npc" } } }]);
    assert.deepEqual(missing, []);
  });
});

test("a deleted Actor is reported as a missing document", async () => {
  // The exact drift that used to be invisible: the page is unchanged, so an
  // incremental sync never revisits it and reports "already up to date".
  const { entryId, pageId } = await import("../scripts/ids.mjs");
  const { findMissingDocuments } = await import("../scripts/instance.mjs");
  const path = "Creatures/Beefy.md";
  const [e, p] = [await entryId(VAULT.id, path), await pageId(VAULT.id, path)];
  await withWorld({ journals: { [e]: [p] }, actors: [] }, async () => {
    const missing = await findMissingDocuments(VAULT, [{ logicalPath: path, meta: { foundry: { base: "Actor:npc" } } }]);
    assert.deepEqual(missing, [{ path, missing: "document" }]);
  });
});

test("a deleted journal page is reported", async () => {
  const { findMissingDocuments } = await import("../scripts/instance.mjs");
  await withWorld({ journals: {}, actors: [] }, async () => {
    const missing = await findMissingDocuments(VAULT, [{ logicalPath: "Lore/Thing.md", meta: {} }]);
    assert.deepEqual(missing, [{ path: "Lore/Thing.md", missing: "journal" }]);
  });
});

test("both missing is reported once, naming both", async () => {
  const { findMissingDocuments } = await import("../scripts/instance.mjs");
  await withWorld({ journals: {}, actors: [] }, async () => {
    const missing = await findMissingDocuments(VAULT, [
      { logicalPath: "Creatures/Beefy.md", meta: { foundry: { base: "Actor:npc" } } },
    ]);
    assert.deepEqual(missing, [{ path: "Creatures/Beefy.md", missing: "journal + document" }]);
  });
});

test("a page with journal: false is not expected to have one", async () => {
  const { instanceId } = await import("../scripts/ids.mjs");
  const { findMissingDocuments } = await import("../scripts/instance.mjs");
  const path = "Scenes/Map.md";
  const i = await instanceId(VAULT.id, path);
  await withWorld({ journals: {}, actors: [i] }, async () => {
    const missing = await findMissingDocuments(VAULT, [
      { logicalPath: path, meta: { foundry: { base: "Actor:npc", journal: false } } },
    ]);
    assert.deepEqual(missing, []);
  });
});

test("a pinned foundry.id is honoured instead of the derived one", async () => {
  const { entryId } = await import("../scripts/ids.mjs");
  const { findMissingDocuments } = await import("../scripts/instance.mjs");
  const path = "Creatures/Beefy.md";
  const e = await entryId(VAULT.id, path);
  await withWorld({ journals: { [e]: ["pinned0000000001"] }, actors: ["pinned0000000001"] }, async () => {
    const missing = await findMissingDocuments(VAULT, [
      { logicalPath: path, meta: { foundry: { base: "Actor:npc", id: "pinned0000000001" } } },
    ]);
    assert.deepEqual(missing, []);
  });
});

// --- the journal-link Map Note -----------------------------------------
//
// The note is placed half a grid cell off the map's grid-aligned top-left
// corner. Its geometry used to be read from the page's frontmatter, which is
// only right when the page carries the whole scene in `data_json`. A Scene
// cloned from a compendium UUID, or resolved from a Moulinette document, takes
// its width, height, grid and padding from the template, and the frontmatter
// may say nothing at all — so the note was placed against 4000x3000 at grid
// 100 and landed somewhere arbitrary on a map of any other size.

import { notePosition, wantsJournalNote } from "../scripts/instance.mjs";

test("places the note against the scene's own geometry", () => {
  // 2100x2100 at grid 140, padding 0.25: origin is ceil(15 * 0.25) = 4 cells,
  // so 560. Half a cell left of that is 490, half a cell below is 630.
  assert.deepEqual(
    notePosition({ width: 2100, height: 2100, padding: 0.25, grid: { size: 140 } }),
    { x: 490, y: 630 },
  );
});

test("a differently-sized scene gets a different corner", () => {
  // The bug: this is what every template-derived Scene used to get, whatever
  // its real size, because the frontmatter carried no dimensions.
  assert.deepEqual(
    notePosition({}),
    { x: 950, y: 850 },
    "the fallback, which should now only apply when nothing knows better",
  );
  assert.deepEqual(
    notePosition({ width: 4200, height: 2800, padding: 0.25, grid: { size: 140 } }),
    { x: 1050, y: 770 },
  );
});

test("rounds the origin up to a whole cell, as Foundry does", () => {
  // 2100/140 * 0.25 = 3.75 cells of padding, and Foundry uses 4.
  const { x } = notePosition({ width: 2100, height: 2100, padding: 0.25, grid: { size: 140 } });
  assert.equal(x, 140 * 3.5, "not 140 * (3.75 - 0.5)");
});

// --- Foundry generation skew -------------------------------------------
//
// Creators re-export for each Foundry generation, and a back catalogue can be
// a generation behind: The MAD Cartographer's newer packs are native v14 while
// everything older is 13.344. A stale document mostly migrates — a v13 Scene
// keeps all 153 walls, 17 lights and 10 sounds — but v14 moved the map onto
// Level and draws that scene's tiles at the canvas origin instead of their
// stored x/y. We import anyway and report it, rather than dropping work that
// did survive or leaving the reader to wonder why a map looks wrong.

import { generationSkew } from "../scripts/instance.mjs";

function withRelease(generation, fn) {
  const prev = globalThis.game;
  globalThis.game = { release: { generation } };
  try { return fn(); } finally { globalThis.game = prev; }
}

test("reports a document exported for an older generation", () => {
  withRelease(14, () => {
    const skew = generationSkew({ _stats: { coreVersion: "13.344" } }, "12977/json/scene/x.json");
    assert.equal(skew?.exported, "13.344");
    assert.equal(skew?.world, 14);
    assert.equal(skew?.ref, "12977/json/scene/x.json");
  });
});

test("says nothing when the generations agree", () => {
  // Patch and minor differences inside one generation are exactly what
  // Foundry's own document migration absorbs.
  withRelease(14, () => {
    assert.equal(generationSkew({ _stats: { coreVersion: "14.361" } }, "r"), null);
    assert.equal(generationSkew({ _stats: { coreVersion: "14.367" } }, "r"), null);
  });
});

test("reports a newer export too, not just an older one", () => {
  withRelease(13, () => {
    assert.equal(generationSkew({ _stats: { coreVersion: "14.364" } }, "r")?.world, 13);
  });
});

test("stays quiet when either version is unreadable", () => {
  // A document with no _stats is not evidence of a problem.
  withRelease(14, () => {
    assert.equal(generationSkew({}, "r"), null);
    assert.equal(generationSkew({ _stats: {} }, "r"), null);
  });
  withRelease(undefined, () => {
    assert.equal(generationSkew({ _stats: { coreVersion: "13.344" } }, "r"), null);
  });
});

// --- bundle strings vs installed-module strings -------------------------
//
// The sync code is bundled by the CLI and ships with the vault; lang/en.json
// ships with the installed module. They update on different schedules by
// design, so a message the bundle introduces reaches modules that have never
// heard of its key — and Foundry's i18n returns the key itself when it cannot
// resolve one, which showed a GM a warning that read "VAULTS.Sync.VersionSkew".

import { localizeOr } from "../scripts/util.mjs";

const CURRENT = { localize: (k, a) => (k === "KNOWN" ? `translated ${a?.count}` : k) };
const OLD = { localize: (k) => k };

test("prefers the module's translation when it has one", () => {
  assert.equal(localizeOr(CURRENT, "KNOWN", "fallback {count}", { count: 2 }), "translated 2");
});

test("falls back to the bundle's own text when the module predates the key", () => {
  assert.equal(localizeOr(OLD, "MISSING", "{count} document(s) skewed", { count: 3 }),
    "3 document(s) skewed");
});

test("leaves an unknown placeholder alone rather than printing undefined", () => {
  assert.equal(localizeOr(OLD, "MISSING", "{count} of {total}", { count: 1 }), "1 of {total}");
});

// `journal: false` and the auto Map Note ---------------------------------
//
// The note links a Scene back to its source article. `journal: false` deletes
// that article — it exists for pages whose only job is to make a document —
// so the note was being pinned at a JournalEntryPage the same sync had just
// removed: a pin that opens nothing.

test("no journal means no journal note", () => {
  assert.equal(wantsJournalNote("Scene", { journal: false }), false);
});

test("a scene with an article still gets one", () => {
  assert.equal(wantsJournalNote("Scene", {}), true);
  assert.equal(wantsJournalNote("Scene", { journal: true }), true);
  assert.equal(wantsJournalNote("Scene", undefined), true);
});

test("only Scenes get one at all", () => {
  assert.equal(wantsJournalNote("Actor", {}), false);
  assert.equal(wantsJournalNote("Playlist", {}), false);
});
