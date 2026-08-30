// Items a page names by uuid instead of carrying.
//
// The trap here is that `uuid` is not a rare key in dnd5e data. An
// advancement's `configuration.items[].uuid` names an item a character may
// later gain — a grant, not a possession. Expanding those would rewrite a
// class feature into the item it promises, so only the document's own `items`
// array is touched.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { isReference, referencedUuids, expandItems } from "../scripts/items.mjs";

const SPELL = "Compendium.dnd5e.spells24.Item.phbsplViciousMoc";
const resolved = new Map([[SPELL, {
  _id: "sourceId00000000", name: "Vicious Mockery", type: "spell",
  img: "icons/magic/x.webp", system: { level: 0 },
}]]);

const entry = (items) => ({ id: "e1", type: "Actor", pack: "p", patch: { name: "Cassius", items } });

describe("isReference", () => {
  test("a reference carries both a uuid and an id", () => {
    assert.equal(isReference({ uuid: SPELL, _id: "vltCAS0000000001" }), true);
  });

  test("a grant is not one: it names an item the vault is not placing", () => {
    // `{ optional, uuid }` inside an advancement's configuration. Every one of
    // this vault's 137 grants looks like this and none of its 123 references
    // does — the id is what says "the vault means to place this".
    assert.equal(isReference({ optional: false, uuid: "Compendium.a.b.Item.c" }), false);
  });

  test("an inline item is not one", () => {
    assert.equal(isReference({ _id: "x", name: "Dagger", type: "weapon" }), false);
    for (const v of [null, undefined, "str", 42, [], { uuid: 7 }]) {
      assert.equal(isReference(v), false, JSON.stringify(v));
    }
  });
});

describe("referencedUuids", () => {
  test("collects each uuid once, in order", () => {
    const es = [entry([{ uuid: SPELL, _id: "i1" }, { uuid: "B", _id: "i2" }]), entry([{ uuid: SPELL, _id: "i3" }])];
    assert.deepEqual(referencedUuids(es), [SPELL, "B"]);
  });

  test("ignores a uuid nested in an advancement, which is a grant", () => {
    // The bug this prevents: turning "may later gain Superior Inspiration"
    // into a copy of Superior Inspiration sitting in the character's bag.
    const e = entry([{
      _id: "cls", name: "Bard", type: "class",
      system: { advancement: { a1: { configuration: { items: [{ uuid: "Compendium.dnd5e.classes24.Item.phbbrdSuperiorIn" }] } } } },
    }]);
    assert.deepEqual(referencedUuids([e]), []);
  });

  test("finds one however deeply it is buried, without being told where", () => {
    // Why the rule is about the object and not its path: an Adventure nests an
    // Actor two levels down, and a shape nobody has thought of yet works the
    // same without a list of shapes to maintain.
    const deep = { a: { b: [{ c: { items: [{ uuid: SPELL, _id: "i1" }] } }] } };
    assert.deepEqual(referencedUuids([{ id: "x", patch: deep }]), [SPELL]);
  });

  test("copes with entries that have no items at all", () => {
    assert.deepEqual(referencedUuids([{ id: "x", patch: {} }, { id: "y" }, null]), []);
  });
});

describe("expandItems", () => {
  test("replaces a reference with the item it names", () => {
    const { patched } = expandItems([entry([{ uuid: SPELL, _id: "vltCAS0000000001" }])], resolved);
    const [item] = patched[0].patch.items;
    assert.equal(item.name, "Vicious Mockery");
    assert.equal(item.type, "spell");
  });

  test("keeps the page's own _id, which the entry was written against", () => {
    // graft merges an items array by _id. Taking the compendium's id instead
    // would make every rebuild add a second copy rather than update the first.
    const { patched } = expandItems([entry([{ uuid: SPELL, _id: "vltCAS0000000001" }])], resolved);
    assert.equal(patched[0].patch.items[0]._id, "vltCAS0000000001");
  });

  test("merges the page's keys over the resolved item", () => {
    const { patched } = expandItems(
      [entry([{ uuid: SPELL, _id: "i1", system: { prepared: 1 } }])], resolved);
    const [item] = patched[0].patch.items;
    assert.equal(item.system.prepared, 1);
    assert.equal(item.system.level, 0, "the compendium's own fields survive");
  });

  test("records where the item came from", () => {
    const { patched } = expandItems([entry([{ uuid: SPELL, _id: "i1" }])], resolved);
    assert.equal(patched[0].patch.items[0]._stats.compendiumSource, SPELL);
  });

  test("drops an item that does not resolve, and says which", () => {
    // An Actor whose items fail to validate does not import at all, so one
    // missing ware has to beat losing the merchant.
    const { patched, warnings } = expandItems(
      [entry([{ uuid: SPELL, _id: "i1" }, { uuid: "Compendium.x.y.Item.gone", _id: "i2" }])], resolved);
    assert.equal(patched[0].patch.items.length, 1);
    assert.match(warnings[0].reason, /did not resolve/);
    assert.equal(warnings[0].id, "Cassius");
  });

  test("leaves inline items exactly as they are", () => {
    const inline = { _id: "x", name: "Dagger", type: "weapon" };
    const { patched } = expandItems([entry([inline, { uuid: SPELL, _id: "i1" }])], resolved);
    assert.deepEqual(patched[0].patch.items[0], inline);
  });

  test("does not touch an entry with no references", () => {
    const e = entry([{ _id: "x", name: "Dagger", type: "weapon" }]);
    const { patched } = expandItems([e], resolved);
    assert.equal(patched[0], e, "returned by identity, not rebuilt");
  });

  test("does not mutate the resolved item, which is shared between entries", () => {
    const es = [entry([{ uuid: SPELL, _id: "a", name: "Renamed" }]), entry([{ uuid: SPELL, _id: "b" }])];
    const { patched } = expandItems(es, resolved);
    assert.equal(patched[1].patch.items[0].name, "Vicious Mockery");
    assert.equal(resolved.get(SPELL).name, "Vicious Mockery");
  });

  test("leaves journal and other entries alone", () => {
    const j = { id: "j", type: "JournalEntry", pack: "p", patch: { pages: [{ text: { content: "x" } }] } };
    const { patched } = expandItems([j], resolved);
    assert.equal(patched[0], j);
  });
});

describe("documents nested in an Adventure", () => {
  // Packaged as an Adventure, an Actor is not a top-level entry any more: it
  // is an element of `actors`, and often `{_id, source, patch}` at that. Its
  // spells are as much in need of expanding as before — missing them produced
  // "items: name: may not be undefined (x114)" and no import at all.
  const adventure = (actors) =>
    ({ id: "adv", type: "Adventure", pack: "p", patch: { name: "V", actors } });

  test("collects uuids from a nested actor", () => {
    const a = adventure([{ _id: "a", items: [{ uuid: SPELL, _id: "i1" }] }]);
    assert.deepEqual(referencedUuids([a]), [SPELL]);
  });

  test("collects them through a sourced nested actor's patch", () => {
    const a = adventure([
      { _id: "a", source: "Compendium.x.y.Actor.z", patch: { items: [{ uuid: SPELL, _id: "i1" }] } },
    ]);
    assert.deepEqual(referencedUuids([a]), [SPELL]);
  });

  test("expands them where they sit, leaving the nesting intact", () => {
    const a = adventure([
      { _id: "a", source: "Compendium.x.y.Actor.z", patch: { items: [{ uuid: SPELL, _id: "i1" }] } },
    ]);
    const { patched } = expandItems([a], resolved);
    const actor = patched[0].patch.actors[0];
    assert.equal(actor.source, "Compendium.x.y.Actor.z", "still a sourced entry");
    assert.equal(actor.patch.items[0].name, "Vicious Mockery");
    assert.equal(actor.patch.items[0]._id, "i1");
  });

  test("does not mutate the entry it was handed", () => {
    const a = adventure([{ _id: "a", items: [{ uuid: SPELL, _id: "i1" }] }]);
    expandItems([a], resolved);
    assert.equal(a.patch.actors[0].items[0].uuid, SPELL);
  });

  test("still ignores a grant nested in an adventure's actor", () => {
    const a = adventure([{ _id: "a", items: [{
      _id: "cls", name: "Bard", type: "class",
      system: { advancement: { x: { configuration: { items: [{ uuid: "Compendium.a.b.Item.c" }] } } } },
    }] }]);
    assert.deepEqual(referencedUuids([a]), []);
  });
});
