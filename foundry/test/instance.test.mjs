// Foundry-side tests. Only the helpers that touch no Foundry globals are
// reachable this way; anything calling Document.create / FilePicker / game.*
// still needs a mock layer that doesn't exist yet (see ROADMAP.md).
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFoundryBase, missingBasePackages } from "../scripts/instance.mjs";

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
// fromUuid that resolves only the packs named in `reachablePacks`. Package ids
// are given as "pkg.pack" — the same granularity the real probe uses, and the
// level at which a system's redirect table operates.
async function withPacks(reachablePacks, fn) {
  const prevGame = globalThis.game;
  const prevFromUuid = globalThis.fromUuid;
  const packs = new Set(reachablePacks);
  globalThis.game = { system: { id: "dnd5e" } };
  globalThis.fromUuid = async (uuid) => {
    const pack = uuid.split(".").slice(1, 3).join(".");
    return packs.has(pack) ? { documentName: "Actor", uuid } : null;
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
  await withPacks([], async () => {
    assert.deepEqual([...await missingBasePackages([page(mmGuard), page(mmGuard)])],
      [["dnd-monster-manual", 2]]);
  });
});

test("a reachable pack is not missing", async () => {
  await withPacks([MM], async () => {
    assert.equal((await missingBasePackages([page(mmGuard)])).size, 0);
  });
});

test("a redirected pack is not reported missing even though its module is inactive", async () => {
  // dnd5e maps Compendium.dnd-monster-manual.actors onto Compendium.dnd5e.actors24,
  // so fromUuid answers for a module that is installed but disabled. Inferring
  // reachability from game.modules would call this missing; probing does not.
  await withPacks([MM], async () => {
    assert.equal((await missingBasePackages([page(mmGuard)])).size, 0);
  });
});

test("blank and world-document bases are never reported", async () => {
  await withPacks([], async () => {
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
  await withPacks([], async () => {
    assert.equal((await missingBasePackages([page([mmGuard, "Actor:npc"])])).size, 0);
  });
});

test("a list is only stranded when every pack is unreachable", async () => {
  await withPacks([], async () => {
    assert.deepEqual([...await missingBasePackages([page([mmGuard, sysGuard])])].sort(),
      [["dnd-monster-manual", 1], ["dnd5e", 1]]);
  });
  await withPacks([SYS], async () => {
    assert.equal((await missingBasePackages([page([mmGuard, sysGuard])])).size, 0,
      "the system pack answers, so nothing is stranded");
  });
});
