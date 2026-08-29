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
