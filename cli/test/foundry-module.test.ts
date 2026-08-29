// Compiling a vault into an installable Foundry module.
//
// The interesting decisions are all about what a module may NOT carry. The
// sync module resolves `foundry.source` against the reader's own world; a
// standalone module has no world to look in, and baking a cloned compendium
// document into something redistributable is a licensing act rather than a
// technical shortcut. So the rule is: build what the vault owns, and be
// explicit about what was left out.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleRollTableResults, keyEmbedded, resolveSelfContainedBase, stripMoulinette,
} from "../src/foundry-module.js";

describe("what a module can build from foundry.source", () => {
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

describe("roll table results", () => {
  const results = (doc: Record<string, unknown>) =>
    doc["results"] as Array<Record<string, unknown>>;

  it("puts a text result's only prose where Foundry shows it", () => {
    // A text result renders its `description`; `name` is a short title, and is
    // empty in every table Foundry itself ships (checked against the DMG and
    // PHB packs in a live v14 world). So a page that writes the row as `name:`
    // — which reads perfectly naturally — compiled to a table of blank rows.
    const doc: Record<string, unknown> = { results: [{ range: [1, 1], name: "A weary ranger." }] };
    assembleRollTableResults(doc, "table0000000001", {});
    assert.equal(results(doc)[0]!["description"], "A weary ranger.");
    assert.equal(results(doc)[0]!["name"], "", "the title stays empty, as Foundry's own tables have it");
    assert.equal(results(doc)[0]!["type"], "text");
  });

  it("leaves a name alone when the row also has a body", () => {
    // Then the author meant both, and the title is a title.
    const doc: Record<string, unknown> = {
      results: [{ name: "Ranger", description: "A weary ranger." }],
    };
    assembleRollTableResults(doc, "table0000000001", {});
    assert.equal(results(doc)[0]!["name"], "Ranger");
    assert.equal(results(doc)[0]!["description"], "A weary ranger.");
  });

  it("a document result keeps its name as the link label", () => {
    const doc: Record<string, unknown> = {
      results: [{ uuid: "Compendium.x.y.Actor.z", name: "Owlbear" }],
    };
    assembleRollTableResults(doc, "table0000000001", {});
    assert.equal(results(doc)[0]!["name"], "Owlbear");
    assert.equal(results(doc)[0]!["type"], "document");
  });

  it("still reads Foundry's pre-13 `text`, the way Foundry migrates it", () => {
    const doc: Record<string, unknown> = {
      results: [{ text: "A lone owlbear." }, { uuid: "Compendium.x.y.Actor.z", text: "Owlbear" }],
    };
    assembleRollTableResults(doc, "table0000000001", {});
    assert.equal(results(doc)[0]!["description"], "A lone owlbear.", "text result: description");
    assert.equal(results(doc)[1]!["name"], "Owlbear", "document result: name");
    assert.equal(results(doc)[1]!["documentUuid"], "Compendium.x.y.Actor.z");
  });

  it("fills in only what the page left out", () => {
    const doc: Record<string, unknown> = { results: [{ name: "Nothing.", img: "icons/mine.webp" }] };
    assembleRollTableResults(doc, "table0000000001", {});
    assert.equal(results(doc)[0]!["img"], "icons/mine.webp");
    assert.equal(results(doc)[0]!["weight"], 1);
    assert.deepEqual(results(doc)[0]!["range"], [1, 1]);
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

describe("packFolders", () => {
  it("files a newly created pack under the module's own folder", async () => {
    // packFolders is hand-authored and names its packs one by one, so a pack
    // that did not exist when it was written lands loose at the top of the
    // compendium sidebar, outside the module's folder. That is what happened
    // the first time the journal pack appeared.
    const { fileNewPacks } = await import("../src/foundry-module.js");
    const manifest: Record<string, unknown> = {
      packFolders: [{
        name: "WANDS",
        packs: ["wands-roll-tables"],
        folders: [{ name: "Items & Spells", packs: ["items-wands"], folders: [] }],
      }],
    };
    fileNewPacks(manifest, ["wands-roll-tables", "items-wands", "wands-journal"]);
    const root = (manifest["packFolders"] as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual(root["packs"], ["wands-roll-tables", "wands-journal"]);
  });

  it("leaves a pack filed in a nested folder where the author put it", async () => {
    const { fileNewPacks } = await import("../src/foundry-module.js");
    const manifest: Record<string, unknown> = {
      packFolders: [{
        name: "WANDS", packs: [],
        folders: [{ name: "Deep", packs: ["spells-wands"], folders: [] }],
      }],
    };
    fileNewPacks(manifest, ["spells-wands"]);
    const root = (manifest["packFolders"] as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual(root["packs"], [], "must not be pulled up out of its folder");
  });

  it("does nothing when the author declared no folders", async () => {
    // Nothing to be outside of, so nothing to fix — and inventing a tree would
    // be restructuring a sidebar the author never asked us to touch.
    const { fileNewPacks } = await import("../src/foundry-module.js");
    const manifest: Record<string, unknown> = {};
    fileNewPacks(manifest, ["wands-journal"]);
    assert.equal(manifest["packFolders"], undefined);
  });
});

describe("--module output directory", () => {
  it("normalises the forms of the same directory", async () => {
    // The value ends up in the manifest's own `download` URL, so a stray `./`
    // or trailing slash would be visible to whoever installs the module.
    const { normalizeVaultRelative } = await import("../src/commands/build.js");
    for (const input of ["downloads", "./downloads", "downloads/", "./downloads/"]) {
      assert.equal(normalizeVaultRelative(input), "downloads", input);
    }
    assert.equal(normalizeVaultRelative("build/foundry"), "build/foundry");
  });

  it("refuses a directory the deploy could not serve", async () => {
    // The zip is served by the vault, so a path outside it compiles happily
    // and produces a manifest pointing at nothing.
    const { normalizeVaultRelative } = await import("../src/commands/build.js");
    for (const bad of ["../outside", "/tmp/abs", "  ", "./"]) {
      assert.throws(() => normalizeVaultRelative(bad), /inside the vault/, bad);
    }
  });
});

describe("journal page overlays", () => {
  it("writes a typed page and drops the body it cannot hold", async () => {
    // An image, video or PDF page's content is its `src`, so there is nowhere
    // for an article to live. Writing `text.content` anyway would ship prose
    // Foundry never renders.
    const { buildJournalEntries } = await import("../src/foundry-module-journal.js");
    const entries = buildJournalEntries([
      { path: "Maps/Delta.md", title: "Delta", html: "<p>prose</p>",
        spec: { type: "image", overlay: { src: "maps/delta.webp" }, dropsBody: true } },
    ], "mod", "Root", {});
    const page = entries[0]!.pages[0]! as Record<string, unknown>;
    assert.equal(page["type"], "image");
    assert.equal(page["src"], "maps/delta.webp");
    assert.equal(page["text"], undefined, "no body on a page whose content is its src");
  });

  it("deep-merges the overlay without losing what the build set", async () => {
    const { buildJournalEntries } = await import("../src/foundry-module-journal.js");
    const entries = buildJournalEntries([
      { path: "Rules/Casting.md", title: "Casting", html: "<p>prose</p>",
        spec: { type: "text", overlay: { title: { show: false } }, dropsBody: false } },
    ], "mod", "Root", {});
    const page = entries[0]!.pages[0]! as Record<string, unknown>;
    const title = page["title"] as Record<string, unknown>;
    assert.equal(title["show"], false, "the overlay wins");
    assert.equal(title["level"], 1, "and the sibling the build set survives");
    assert.equal((page["text"] as Record<string, unknown>)["content"], "<p>prose</p>");
  });

  it("a page with no foundry block is an ordinary text page", async () => {
    const { buildJournalEntries } = await import("../src/foundry-module-journal.js");
    const entries = buildJournalEntries([
      { path: "Lore/Thing.md", title: "Thing", html: "<p>prose</p>" },
    ], "mod", "Root", {});
    const page = entries[0]!.pages[0]! as Record<string, unknown>;
    assert.equal(page["type"], "text");
    assert.equal((page["text"] as Record<string, unknown>)["content"], "<p>prose</p>");
  });
});
