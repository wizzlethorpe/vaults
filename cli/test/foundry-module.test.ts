// Compiling a vault into an installable Foundry module.
//
// The interesting decisions are all about what a module may NOT carry. The
// sync module resolves `foundry.base` against the reader's own world; a
// standalone module has no world to look in, and baking a cloned compendium
// document into something redistributable is a licensing act rather than a
// technical shortcut. So the rule is: build what the vault owns, and be
// explicit about what was left out.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keyEmbedded, resolveSelfContainedBase, stripMoulinette } from "../src/foundry-module.js";

describe("what a module can build from foundry.base", () => {
  it("takes a blank type as-is", () => {
    assert.deepEqual(resolveSelfContainedBase(["RollTable"]), { blank: "RollTable" });
    assert.deepEqual(resolveSelfContainedBase(["Actor:npc"]), { blank: "Actor", subtype: "npc" });
  });

  it("falls to the last self-contained rung of a priority list", () => {
    // A list already says "use this if you have it, otherwise that", and a
    // standalone module is exactly the otherwise case.
    assert.deepEqual(
      resolveSelfContainedBase(["Compendium.dnd5e.monsters.Actor.abc123", "Actor:npc"]),
      { blank: "Actor", subtype: "npc" },
    );
  });

  it("refuses a base that only names content the reader must already own", () => {
    // Not a limitation to route around: redistributing someone else's
    // compendium document is a licensing question, not a build one.
    assert.equal(resolveSelfContainedBase(["Compendium.dnd5e.monsters.Actor.abc123"]), null);
    assert.equal(resolveSelfContainedBase(["@moulinette/11938/json/scene/x.json"]), null);
    assert.equal(resolveSelfContainedBase([]), null);
  });
});

describe("moulinette references", () => {
  it("drops the reference and whatever contained it", () => {
    // A module has no importer and no library to resolve against, so a
    // surviving @moulinette/ string would just be a broken path.
    const found = new Set<string>();
    const out = stripMoulinette({
      name: "Tavern",
      background: { src: "@moulinette/1/map.webp" },
      sounds: [{ path: "@moulinette/2/a.ogg" }, { path: "assets/keep.ogg" }],
    }, found) as Record<string, unknown>;
    assert.equal(out["background"], undefined);
    assert.deepEqual(out["sounds"], [{ path: "assets/keep.ogg" }]);
    assert.equal(out["name"], "Tavern", "the document itself survives");
    assert.equal(found.size, 2);
  });
});

describe("embedded documents", () => {
  it("keys each one, since a pack stores them as separate entries", () => {
    // Without this the Foundry CLI fails with "Key cannot be null or
    // undefined", naming neither the document nor the field.
    const doc: Record<string, unknown> = { _id: "table0000000001", results: [{ range: [1, 1] }, { range: [2, 2] }] };
    keyEmbedded(doc, "tables", "table0000000001");
    const results = doc["results"] as Array<Record<string, unknown>>;
    assert.match(results[0]!["_key"] as string, /^!tables\.results!table0000000001\./);
    assert.notEqual(results[0]!["_id"], results[1]!["_id"], "distinct ids");
  });

  it("derives ids stably, so a rebuild does not renumber the pack", () => {
    const once: Record<string, unknown> = { results: [{ range: [1, 1] }] };
    const twice: Record<string, unknown> = { results: [{ range: [1, 1] }] };
    keyEmbedded(once, "tables", "t1");
    keyEmbedded(twice, "tables", "t1");
    assert.equal(
      (once["results"] as Array<Record<string, unknown>>)[0]!["_id"],
      (twice["results"] as Array<Record<string, unknown>>)[0]!["_id"],
    );
  });

  it("nests keys through embedded documents of embedded documents", () => {
    // An effect on an item on an actor is !actors.items.effects!a.i.e — the
    // shape the Foundry CLI wants and refuses to derive.
    const doc: Record<string, unknown> = {
      _id: "actor00000000001",
      items: [{ _id: "item00000000001", effects: [{ name: "Bless" }] }],
    };
    keyEmbedded(doc, "actors", "actor00000000001");
    const item = (doc["items"] as Array<Record<string, unknown>>)[0]!;
    assert.equal(item["_key"], "!actors.items!actor00000000001.item00000000001");
    const effect = (item["effects"] as Array<Record<string, unknown>>)[0]!;
    assert.match(effect["_key"] as string, /^!actors\.items\.effects!actor00000000001\.item00000000001\./);
  });

  it("keeps an id the author pinned", () => {
    const doc: Record<string, unknown> = { results: [{ _id: "mine000000000001" }] };
    keyEmbedded(doc, "tables", "t1");
    assert.equal((doc["results"] as Array<Record<string, unknown>>)[0]!["_id"], "mine000000000001");
  });
});
