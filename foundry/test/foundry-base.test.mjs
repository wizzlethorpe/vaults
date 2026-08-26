// The canonical reading of `foundry.base`, and a guard on the copies.
//
// Five implementations of this existed and disagreed. instance.mjs, links.mjs
// and importer.mjs now share foundry-base.mjs. cli/src/build.ts and
// foundry-compiler still have their own — they are TypeScript packages with
// rootDir: ./src, so importing this module would mean reshaping their
// tsconfigs — so CASES below is the contract all five must satisfy, and
// cli/test/foundry-base-conformance.test.ts checks the CLI against the same
// table. A future divergence fails a test instead of a user's wikilinks.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFoundryBase, docNameOf, docNameFromBase } from "../scripts/foundry-base.mjs";

/** [input, expected document type] */
export const CASES = [
  // Blank-document form.
  ["Actor:npc", "Actor"],
  ["Item:weapon", "Item"],
  ["Scene", "Scene"],
  // Case-insensitive, because role and type names are hand-typed in YAML.
  // links.mjs used to return "actor" here and emit a dead @UUID[actor.<id>].
  ["actor:npc", "Actor"],
  ["ACTOR", "Actor"],
  ["Actor:NPC", "Actor"],
  // Compendium UUID: type is the second-to-last segment.
  ["Compendium.dnd5e.monsters.Actor.O3ABqI55Ir1du1Xa", "Actor"],
  ["Compendium.dnd-monster-manual.actors.Actor.mmGuard000000000", "Actor"],
  ["Compendium.a.b.Item.cccccccccccccccc", "Item"],
  // World document UUID.
  ["Actor.abc1234567890123", "Actor"],
  // Embedded UUID: still second-to-last.
  ["Actor.abc1234567890123.Item.def4567890123456", "Item"],
  // Priority list: the first entry answers for the page. importer.mjs used to
  // return null for any array, so the "Open in Foundry" link vanished.
  [["Compendium.a.b.Actor.cccccccccccccccc", "Actor:npc"], "Actor"],
  [["Actor:npc"], "Actor"],
  // Not a base at all.
  ["", null],
  [null, null],
  [undefined, null],
  [42, null],
  [[], null],
  ["NotAType", null],
  ["NotAType:sub", null],
];

test("docNameFromBase agrees with the contract", () => {
  for (const [input, expected] of CASES) {
    assert.equal(docNameFromBase(input), expected, `for ${JSON.stringify(input)}`);
  }
});

test("parseFoundryBase distinguishes the two spec forms", () => {
  assert.deepEqual(parseFoundryBase("Actor:npc"), { kind: "blank", docName: "Actor", subtype: "npc" });
  assert.deepEqual(parseFoundryBase("Scene"), { kind: "blank", docName: "Scene", subtype: undefined });
  assert.deepEqual(parseFoundryBase("Actor.abc1234567890123"),
    { kind: "uuid", uuid: "Actor.abc1234567890123" });
});

test("a lowercase blank spec canonicalises its type", () => {
  // The concrete bug: instance.mjs made an Actor while links.mjs pointed at
  // "actor", and Foundry's enricher lookup is case-sensitive.
  assert.equal(parseFoundryBase("actor:npc")?.docName, "Actor");
  assert.equal(docNameOf(parseFoundryBase("actor:npc")), "Actor");
});

test("an unknown document type in a UUID passes through rather than vanishing", () => {
  // vaults can't instantiate a Combat, but Foundry may still resolve the
  // UUID, so the type is reported instead of being nulled out.
  assert.equal(docNameFromBase("Compendium.x.y.Combat.aaaaaaaaaaaaaaaa"), "Combat");
});
