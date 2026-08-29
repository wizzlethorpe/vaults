// Compiling a vault into a grafts.json.
//
// The decision this file exists to protect is which rendered variant a page's
// body comes from. A player-observable document must carry the body a player
// would have been served; taking the GM's variant instead publishes `[!dm]`
// blocks to the table, and it would do it silently.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildGrafts, journalEntries, documentEntries, documentTypeOf, visibility,
  entryId, pageId, folderOf, type Page, type GraftOptions,
} from "../src/foundry-grafts.js";

const opts: GraftOptions = {
  vaultId: "marlo",
  roles: ["public", "player", "dm"],
  playerRole: "player",
  buildRole: "dm",
  packs: { JournalEntry: "marlo-journals", Actor: "marlo-actors", Item: "marlo-items" },
  version: "1.4.0",
};

const page = (path: string, over: Partial<Page> = {}): Page =>
  ({ path, title: path.split("/").pop()!.replace(/\.md$/, ""), role: "public", ...over });

describe("visibility", () => {
  it("gives a player-visible page the player's own variant", () => {
    // Not the GM's. The GM's token can fetch any variant, so picking the wrong
    // one is a leak that nothing downstream would catch.
    const v = visibility(page("Characters/Marlo.md", { role: "public" }), opts);
    assert.deepEqual(v, { variant: "player", ownership: 2 });
  });

  it("keeps anything above the player ceiling hidden, from the GM's variant", () => {
    const v = visibility(page("Secrets/Rot.md", { role: "dm" }), opts);
    assert.deepEqual(v, { variant: "dm", ownership: 0 });
  });

  it("treats a role at the ceiling as visible", () => {
    assert.equal(visibility(page("x.md", { role: "player" }), opts).ownership, 2);
  });

  it("treats an unknown role as privileged, not public", () => {
    // A typo in a role name must fail closed.
    assert.deepEqual(visibility(page("x.md", { role: "typo" }), opts),
      { variant: "dm", ownership: 0 });
  });
});

describe("journal entries", () => {
  it("makes one entry per directory, with a page per file", () => {
    const entries = journalEntries([
      page("Characters/Marlo.md"), page("Characters/Vex.md"), page("Places/Keep.md"),
    ], opts);

    assert.deepEqual(entries.map((e) => e.patch["name"]), ["Characters", "Places"]);
    assert.equal((entries[0]!.patch["pages"] as unknown[]).length, 2);
    assert.equal(entries[0]!.pack, "marlo-journals");
  });

  it("never carries a body, only a reference to one", () => {
    // Inlining would make this file megabytes and re-download every page on
    // every build. The provider batches these through /_batch instead.
    const [entry] = journalEntries([page("Characters/Marlo.md")], opts);
    const pages = entry!.patch["pages"] as Array<Record<string, any>>;
    assert.equal(pages[0]!.text.content, "@vaults/player/Characters/Marlo.body.html");
  });

  it("opens the entry when any page inside is visible, and hides the rest", () => {
    // A player cannot see a page whose entry they cannot see, so the entry has
    // to open; per-page ownership then does the filtering.
    const [entry] = journalEntries([
      page("Mixed/Public.md", { role: "public" }),
      page("Mixed/Secret.md", { role: "dm" }),
    ], opts);

    assert.equal((entry!.patch["ownership"] as any).default, 2, "the entry opens");
    const pages = entry!.patch["pages"] as Array<Record<string, any>>;
    assert.deepEqual(pages.map((p) => p.ownership.default), [2, 0]);
    assert.match(pages[1]!.text.content, /^@vaults\/dm\//, "and the hidden one takes the GM variant");
  });

  it("keeps a wholly private directory shut", () => {
    const [entry] = journalEntries([page("Secrets/Rot.md", { role: "dm" })], opts);
    assert.equal((entry!.patch["ownership"] as any).default, 0);
  });
});

describe("ids", () => {
  it("are stable across content changes, because they come from the path", () => {
    // An id that moved would orphan what it built: pruning deletes the old
    // document and hydration makes a new one, breaking every link to it.
    assert.equal(pageId("marlo", "A/B.md"), pageId("marlo", "A/B.md"));
    assert.notEqual(pageId("marlo", "A/B.md"), pageId("marlo", "A/C.md"));
    assert.notEqual(pageId("marlo", "A/B.md"), pageId("other", "A/B.md"), "namespaced by vault");
    assert.match(pageId("marlo", "A/B.md"), /^[a-z0-9]{16}$/);
  });

  it("group a directory's pages under one entry", () => {
    assert.equal(entryId("marlo", folderOf("A/B.md")), entryId("marlo", folderOf("A/C.md")));
  });
});

describe("documents from foundry.base", () => {
  it("become a graft of what they are based on", () => {
    // This is the whole of what instance.mjs did at runtime.
    const { entries } = documentEntries([
      page("Characters/Marlo.md", {
        role: "dm",
        foundry: { base: "Compendium.some-bestiary.actors.Actor.mmBandit000000",
                   data: { system: { attributes: { hp: { value: 45 } } } } },
      }),
    ], opts);

    assert.equal(entries[0]!.source, "Compendium.some-bestiary.actors.Actor.mmBandit000000");
    assert.equal(entries[0]!.type, "Actor");
    assert.equal(entries[0]!.pack, "marlo-actors");
    assert.deepEqual(entries[0]!.patch["system"], { attributes: { hp: { value: 45 } } });
    assert.equal((entries[0]!.patch["ownership"] as any).default, 0);
  });

  it("a page inventing its own document has no source", () => {
    const { entries } = documentEntries([
      page("Items/Sword.md", { foundry: { base: "Item", data: { type: "weapon" } } }),
    ], opts);
    assert.ok(!("source" in entries[0]!), "absent means the patch is the document");
    assert.equal(entries[0]!.type, "Item");
  });

  it("names what it could not place rather than dropping it", () => {
    const { entries, warnings } = documentEntries([
      page("x.md", { foundry: { base: "Compendium.a.b.Scene.cccccccccccccccc" } }),
      page("y.md", { foundry: { base: "nonsense" } }),
    ], opts);
    assert.deepEqual(entries, []);
    assert.match(warnings[0]!, /no pack declared for Scene/);
    assert.match(warnings[1]!, /cannot tell what kind/);
  });
});

describe("documentTypeOf", () => {
  it("reads the type out of a compendium UUID", () => {
    assert.equal(documentTypeOf("Compendium.mod.pack.Actor.aaaaaaaaaaaaaaaa"), "Actor");
    assert.equal(documentTypeOf("Compendium.mod.pack.RollTable.aaaaaaaaaaaaaaaa"), "RollTable");
  });
  it("accepts a bare type for a page with no source", () => {
    assert.equal(documentTypeOf("Scene"), "Scene");
  });
  it("refuses anything else", () => {
    assert.equal(documentTypeOf("Compendium.too.short"), null);
    assert.equal(documentTypeOf("lowercase"), null);
    assert.equal(documentTypeOf(""), null);
  });
});

describe("the whole file", () => {
  it("declares its format and the vault version", () => {
    // The format lets a newer vault refuse an older graft rather than be
    // half-read; the version is what the freshness prompt compares.
    const { file } = buildGrafts([page("A/B.md")], opts);
    assert.equal(file.format, 1);
    assert.equal(file.version, "1.4.0");
    assert.equal(file.entries.length, 1);
  });
});

describe("the module a vault ships", () => {
  it("declares every pack type, used or not", async () => {
    // Packs are read when the server starts, so a vault that later gains its
    // first Scene would otherwise need reinstalling and a restart.
    const { moduleManifest, PACK_SUFFIX } = await import("../src/foundry-grafts.js");
    const m = moduleManifest({ moduleId: "marlo", title: "Marlo", vaultUrl: "https://marlo.example.com/", version: "1.4.0" });
    const packs = m["packs"] as Array<Record<string, any>>;
    assert.equal(packs.length, Object.keys(PACK_SUFFIX).length);
    assert.ok(packs.every((p) => p.ownership.PLAYER === "NONE"), "never player-browsable");
    assert.ok(packs.filter((p) => p.type === "Actor" || p.type === "Item").every((p) => p.system));
  });

  it("requires graft and the provider, so a missing one is Foundry's error", async () => {
    const { moduleManifest } = await import("../src/foundry-grafts.js");
    const m = moduleManifest({ moduleId: "marlo", title: "Marlo", vaultUrl: "https://marlo.example.com", version: "1.4.0" });
    const ids = ((m["relationships"] as any).requires as Array<any>).map((r) => r.id);
    assert.deepEqual(ids, ["graft", "wizzlethorpe-vaults"]);
    assert.equal(m["manifest"], "https://marlo.example.com/_foundry/module.json");
  });

  it("ships a pointer, not a list", async () => {
    const { moduleGrafts } = await import("../src/foundry-grafts.js");
    assert.deepEqual(moduleGrafts("https://marlo.example.com/"), [{ vault: "https://marlo.example.com" }]);
  });

  it("only offers a role the pages it may see", async () => {
    const { pagesFrom } = await import("../src/foundry-grafts.js");
    const metas = [
      { path: "A.md", title: "A", role: "public" },
      { path: "B.md", title: "B", role: "dm", frontmatter: { foundry: { base: "Actor" } } },
    ];
    assert.deepEqual(pagesFrom(metas, new Set(["public"])).map((p) => p.path), ["A.md"]);
    const all = pagesFrom(metas, new Set(["public", "dm"]));
    assert.equal(all.length, 2);
    assert.deepEqual(all[1]!.foundry, { base: "Actor" });
  });
});

describe("a base priority list", () => {
  it("travels whole, so the fallback survives", async () => {
    // graft tries each in order, so a page can prefer better content without
    // demanding the reader own it.
    const { documentEntries, basesOf } = await import("../src/foundry-grafts.js");
    const { entries, warnings } = documentEntries([{
      path: "x.md", title: "X", role: "dm",
      foundry: { base: ["Compendium.a.b.Actor.aaaaaaaaaaaaaaaa", "Compendium.c.d.Actor.bbbbbbbbbbbbbbbb"] },
    }], opts);

    assert.deepEqual(entries[0]!.source,
      ["Compendium.a.b.Actor.aaaaaaaaaaaaaaaa", "Compendium.c.d.Actor.bbbbbbbbbbbbbbbb"]);
    assert.deepEqual(warnings, []);
    assert.deepEqual(basesOf(["", "Compendium.a.b.Actor.cccccccccccccccc"]),
      ["Compendium.a.b.Actor.cccccccccccccccc"]);
  });

  it("a single base stays a plain string", async () => {
    const { documentEntries } = await import("../src/foundry-grafts.js");
    const { entries } = documentEntries([{
      path: "x.md", title: "X", role: "dm",
      foundry: { base: ["Compendium.a.b.Actor.aaaaaaaaaaaaaaaa"] },
    }], opts);
    assert.equal(typeof entries[0]!.source, "string");
  });

  it("refuses anything that is not a UUID or a list of them", async () => {
    const { documentEntries, basesOf } = await import("../src/foundry-grafts.js");
    assert.deepEqual(basesOf(42), []);
    assert.deepEqual(basesOf([]), []);
    assert.deepEqual(basesOf({ uuid: "x" }), []);
    const { warnings } = documentEntries([{ path: "y.md", title: "Y", role: "dm", foundry: { base: 42 } }], opts);
    assert.match(warnings[0]!, /should be a UUID or a list/);
  });
});

describe("a bare base with a subtype", () => {
  it("splits the schema from the kind", async () => {
    // `Actor:npc` is a page inventing an NPC rather than grafting one: Actor
    // is the schema graft builds into, npc is a field on the document.
    const { documentEntries, documentTypeOf, subtypeOf } = await import("../src/foundry-grafts.js");
    assert.equal(documentTypeOf("Actor:npc"), "Actor");
    assert.equal(subtypeOf("Actor:npc"), "npc");
    assert.equal(subtypeOf("Compendium.a.b.Actor.cccccccccccccccc"), null, "a source carries its own");

    const { entries, warnings } = documentEntries([{
      path: "NPCs/Mossroot.md", title: "Mossroot", role: "dm", foundry: { base: "Actor:npc" },
    }], opts);
    assert.deepEqual(warnings, []);
    assert.equal(entries[0]!.type, "Actor");
    assert.equal(entries[0]!.patch["type"], "npc");
    assert.ok(!("source" in entries[0]!), "invented, not grafted");
  });
});

describe("each role's file is buildable by that role", () => {
  it("never references a variant above the reader who receives it", async () => {
    // The file is served through the same gate as everything else, so a body
    // it names above the reader's role is one they cannot fetch.
    const { journalEntries } = await import("../src/foundry-grafts.js");
    const asPublic = { ...opts, buildRole: "public", playerRole: "" };
    const [entry] = journalEntries([page("Secrets/Rot.md", { role: "dm" })], asPublic);
    const pages = entry!.patch["pages"] as Array<Record<string, any>>;
    assert.match(pages[0]!.text.content, /^@vaults\/public\//);
  });
});

describe("an unset player role", () => {
  it("publishes nothing, rather than defaulting to the lowest role", async () => {
    // "Empty means none of it is [player-visible]" is what the setting
    // documents, and it is the only safe reading: a vault that has not opted
    // in must not put content in front of the table.
    const { visibility, journalEntries } = await import("../src/foundry-grafts.js");
    const shut = { ...opts, playerRole: "" };

    assert.deepEqual(visibility(page("A.md", { role: "public" }), shut), { variant: "dm", ownership: 0 });
    const [entry] = journalEntries([page("A.md", { role: "public" })], shut);
    assert.equal((entry!.patch["ownership"] as any).default, 0);
  });
});
