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
