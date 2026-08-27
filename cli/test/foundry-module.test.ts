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

// --- journals -------------------------------------------------------------
//
// A module mirrors the sync model: one JournalEntry per vault directory, every
// .md in it a page. Matching that is the whole point — a document embeds a
// journal page, and if the two laid journals out differently the same vault
// would produce two different-shaped things depending on how a reader got it.

import {
  buildJournalEntries, folderOfPath, journalEntryId, transformForModule,
} from "../src/foundry-module-journal.js";

describe("journal grouping", () => {
  it("puts every page in a directory into one entry, as sync does", () => {
    const entries = buildJournalEntries([
      { path: "Roll Tables/Curses.md", title: "Curses", html: "<p>a</p>" },
      { path: "Roll Tables/Quirks.md", title: "Quirks", html: "<p>b</p>" },
      { path: "index.md", title: "Home", html: "<p>c</p>" },
    ], "mod", "My Module", {});
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.pages.length]));
    assert.deepEqual(byName, { "Roll Tables": 2, "My Module": 1 });
  });

  it("gives every page in a directory the same entry id", () => {
    assert.equal(
      journalEntryId("mod", "Roll Tables/Curses.md"),
      journalEntryId("mod", "Roll Tables/Quirks.md"),
    );
    assert.notEqual(journalEntryId("mod", "a/x.md"), journalEntryId("mod", "b/x.md"));
  });

  it("reads a root-level page as living in no folder", () => {
    assert.equal(folderOfPath("index.md"), "");
    assert.equal(folderOfPath("a/b/c.md"), "a/b");
  });
});

describe("journal HTML", () => {
  const targets = new Map([["Roll Tables/Curses", {
    uuid: "Compendium.m.m-journal.JournalEntry.e1.JournalEntryPage.p1", entryId: "e1", pageId: "p1",
  }]]);

  it("rewrites an internal link whatever order its attributes came in", () => {
    // The renderer emits class before href in some cases and after in others.
    // Anchoring on href first silently missed half the links in the vault.
    for (const tag of [
      '<a href="/Roll%20Tables/Curses" class="internal internal-link">Curses</a>',
      '<a class="internal internal-link" href="/Roll%20Tables/Curses">Curses</a>',
    ]) {
      const out = transformForModule(tag, "m", targets, new Set());
      assert.match(out, /@UUID\[Compendium\.m\.m-journal\.JournalEntry\.e1\.JournalEntryPage\.p1\]\{Curses\}/);
    }
  });

  it("keeps the words when the target is not in the module", () => {
    const out = transformForModule('<a class="internal" href="/Missing">Gone</a>', "m", targets, new Set());
    assert.equal(out, "Gone", "a dead link is worse than plain text");
  });

  it("leaves an external link alone", () => {
    const tag = '<a href="https://example.com">out</a>';
    assert.equal(transformForModule(tag, "m", targets, new Set()), tag);
  });

  it("moves media onto the module and records it for bundling", () => {
    const assets = new Set<string>();
    const out = transformForModule('<img src="/attachments/map.webp">', "m", targets, assets);
    assert.match(out, /src="modules\/m\/assets\/attachments\/map\.webp"/);
    assert.deepEqual([...assets], ["attachments/map.webp"]);
  });
});

// --- where a module goes, and what it may rewrite --------------------------
//
// Two ways a module reaches a reader, and the manifest already says which. One
// that names its own `download` is published elsewhere — a GitHub release —
// so its packs belong beside it and those URLs are the author's. One with no
// download is served by the vault, so it gets a zip and a relative URL.

describe("journal scoping", () => {
  it("takes a list of folders, not just on or off", () => {
    // The case that matters: WANDS wants its Rules chapters as articles but
    // not its Compendium pages, whose prose is already each item's text.
    const inScope = (folders: string[] | null, path: string): boolean =>
      folders === null ? true : folders.some((f) => path === f || path.startsWith(`${f}/`));
    assert.equal(inScope(["Rules"], "Rules/Chapter 1 - Houses.md"), true);
    assert.equal(inScope(["Rules"], "Compendium/Spells/Accio.md"), false);
    assert.equal(inScope(["Rules"], "Rulesmith/x.md"), false, "prefix must be a whole segment");
    assert.equal(inScope(null, "anything.md"), true);
  });
});

describe("pack system declarations", () => {
  it("reads the system from relationships, not just a top-level key", async () => {
    // Foundry refuses to load a manifest where any Actor or Item pack omits
    // `system`, and most modules never set a top-level `system` key — they
    // name it in relationships.requires, which is what the package schema
    // documents. WANDS does exactly that, shipped ten packs with none, and
    // Foundry rejected the module at install time. Nothing at build time
    // noticed, which is why this is pinned here.
    const { systemIdOf } = await import("../src/foundry-module.js");

    assert.equal(systemIdOf({
      relationships: { requires: [{ id: "dnd5e", type: "system" }] },
    }), "dnd5e");

    // A module relationship is not a system, and picking the first entry
    // whatever its type would declare packs belonging to "babele".
    assert.equal(systemIdOf({
      relationships: {
        requires: [{ id: "babele", type: "module" }, { id: "dnd5e", type: "system" }],
      },
    }), "dnd5e");

    assert.equal(systemIdOf({ relationships: { systems: [{ id: "pf2e" }] } }), "pf2e");
    assert.equal(systemIdOf({ system: "dnd5e" }), "dnd5e");
    // System-agnostic modules exist; they must not gain a bogus declaration.
    assert.equal(systemIdOf({}), null);
    assert.equal(systemIdOf({ relationships: { requires: [{ id: "babele", type: "module" }] } }), null);
  });
});
