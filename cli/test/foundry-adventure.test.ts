// Packaging a vault as one Adventure.
//
// Two things make this different from a shelf of packs rather than a rename of
// one. An Actor here is usually a patch over a compendium statblock, and it has
// to keep saying so — flattened, it would arrive as a name and a portrait with
// no statblock under them. And a link has to name the copy the GM imported,
// because that is the copy they are reading.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { asAdventure } from "../src/foundry-adventure.js";
import type { GraftEntry } from "../src/foundry-grafts.js";

const opts = {
  id: "advent0000000001", pack: "v-adventure", name: "The Vault",
  folderId: (type: string, path: string) => `${type}:${path}`,
};
const entry = (over: Partial<GraftEntry> = {}): GraftEntry =>
  ({ id: "a1", type: "Actor", pack: "v-actors", patch: { name: "Marlo" }, ...over });

describe("asAdventure", () => {
  it("returns exactly one entry, holding everything", () => {
    const { entries } = asAdventure([
      entry(),
      entry({ id: "j1", type: "JournalEntry", patch: { name: "Home" } }),
      entry({ id: "s1", type: "Scene", patch: { name: "River" } }),
    ], opts);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.type, "Adventure");
    assert.equal(entries[0]!.pack, "v-adventure");
  });

  it("files each type under the field the Adventure schema uses", () => {
    // Not the pack name and not the document name: `journal`, not `journals`
    // or `JournalEntry`. Foundry reads these by field.
    const { entries } = asAdventure([
      entry({ id: "j1", type: "JournalEntry", patch: {} }),
      entry({ id: "t1", type: "RollTable", patch: {} }),
      entry({ id: "m1", type: "Macro", patch: {} }),
    ], opts);
    const patch = entries[0]!.patch as Record<string, unknown[]>;
    assert.ok(Array.isArray(patch["journal"]), "journal");
    assert.ok(Array.isArray(patch["tables"]), "tables");
    assert.ok(Array.isArray(patch["macros"]), "macros");
  });

  it("keeps a source in the shape graft resolves inside an array", () => {
    // `{ _id, source, patch }` — what expandSources looks for. Flattening this
    // would put a name and a portrait in the Adventure and no statblock.
    const { entries } = asAdventure(
      [entry({ source: "Compendium.dnd5e.actors24.Actor.mmMage0000000000" })], opts);
    const [actor] = (entries[0]!.patch as any).actors;
    assert.equal(actor._id, "a1");
    assert.equal(actor.source, "Compendium.dnd5e.actors24.Actor.mmMage0000000000");
    assert.deepEqual(actor.patch, { name: "Marlo" });
  });

  it("inlines an entry that has no source", () => {
    const { entries } = asAdventure([entry()], opts);
    const [actor] = (entries[0]!.patch as any).actors;
    assert.deepEqual(actor, { _id: "a1", name: "Marlo" });
  });

  it("takes the first of a priority list, and says what it dropped", () => {
    const { entries, warnings } = asAdventure(
      [entry({ source: ["Compendium.a.b.Actor.better", "Compendium.a.b.Actor.plain"] })], opts);
    assert.equal((entries[0]!.patch as any).actors[0].source, "Compendium.a.b.Actor.better");
    assert.ok(warnings.some((w) => w.includes("fallback")), warnings.join("; "));
  });

  it("reports a type an Adventure cannot hold, rather than dropping it quietly", () => {
    const { entries, warnings } = asAdventure(
      [entry(), entry({ id: "x1", type: "Adventure", patch: {} })], opts);
    assert.equal((entries[0]!.patch as any).actors.length, 1);
    assert.ok(warnings.some((w) => w.includes("nowhere to put")), warnings.join("; "));
  });

  it("carries folders, so an imported vault is not one flat list", () => {
    // Foundry folders are typed, so the same path holding two document types
    // is two folders, and a parent has to exist before a child can name it.
    const { entries } = asAdventure([
      entry({ id: "a1", type: "Actor", folder: "Actors/Nobles" }),
      entry({ id: "j1", type: "JournalEntry", folder: "Actors", patch: {} }),
    ], opts);
    const patch = entries[0]!.patch as any;
    assert.deepEqual(patch.folders.map((f: any) => f._id),
      ["Actor:Actors", "Actor:Actors/Nobles", "JournalEntry:Actors"]);
    assert.equal(patch.folders[1].folder, "Actor:Actors");
    assert.equal(patch.folders[1].name, "Nobles");
    assert.equal(patch.actors[0].folder, "Actor:Actors/Nobles");
    assert.equal(patch.journal[0].folder, "JournalEntry:Actors");
  });

  it("puts a sourced entry's folder inside the patch", () => {
    // `expandSources` reads only `_id`, `source` and `patch`; a folder beside
    // them is dropped on the way through.
    const { entries } = asAdventure(
      [entry({ source: "Compendium.a.b.Actor.c", folder: "Actors" })], opts);
    const [actor] = (entries[0]!.patch as any).actors;
    assert.equal(actor.folder, undefined);
    assert.equal(actor.patch.folder, "Actor:Actors");
  });

  it("emits no folders key when nothing is in one", () => {
    assert.equal((asAdventure([entry()], opts).entries[0]!.patch as any).folders, undefined);
  });

  it("names the Adventure so the import dialog says something", () => {
    assert.equal((asAdventure([entry()], opts).entries[0]!.patch as any).name, "The Vault");
  });
});
