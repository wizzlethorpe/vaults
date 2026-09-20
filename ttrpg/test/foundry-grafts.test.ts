// Compiling a vault into a grafts.json.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildGrafts, journalEntries, documentEntries, documentTypeOf, observable, secretRoles, sourceOf, pageDocumentType, subtypeOf,
  entryId, pageId, instanceId, itemId, withItemIds, withEmbeddedIds, folderOf, pagesFrom, linkIndex, withFolderIndexes, type Page, type GraftOptions,
} from "../src/foundry-grafts.js";

const opts: GraftOptions = {
  vaultId: "marlo",
  roles: ["public", "player", "dm"],
  playerRole: "player",
  assetBase: "vaults/marlo",
  namedAssets: new Set(),
  body: (p) => `<p>${p.title}</p>`,
};

const page = (path: string, over: Partial<Page> = {}): Page =>
  ({ path, title: path.split("/").pop()!.replace(/\.md$/, ""), role: "public", ...over });

describe("observable", () => {
  it("marks a page at or below the player ceiling observable", () => {
    assert.equal(observable(page("Characters/Marlo.md", { role: "public" }), opts), true);
    assert.equal(observable(page("x.md", { role: "player" }), opts), true);
  });

  it("keeps anything above the player ceiling hidden", () => {
    assert.equal(observable(page("Secrets/Rot.md", { role: "dm" }), opts), false);
  });

  it("names the roles above the player ceiling as secret, lowercased as a callout names them", () => {
    assert.deepEqual([...secretRoles({ ...opts, roles: ["public", "Player", "DM"], playerRole: "Player" })], ["dm"]);
  });

  it("treats an unknown role as privileged, not public", () => {
    // A typo in a role name must fail closed.
    assert.equal(observable(page("x.md", { role: "typo" }), opts), false);
  });
});

describe("journal entries", () => {
  it("makes one entry per directory, with a page per file", () => {
    const entries = journalEntries([
      page("Characters/Marlo.md"), page("Characters/Vex.md"), page("Places/Keep.md"),
    ], opts);

    assert.deepEqual(entries.map((e) => e.patch["name"]), ["Characters", "Places"]);
    assert.equal((entries[0]!.patch["pages"] as unknown[]).length, 2);
  });

  it("puts the index first, then orders by title as the wiki's sidebar does, numbers by value", () => {
    const [entry] = journalEntries([
      page("Recaps/Session 10.md"), page("Recaps/Session 2.md"), page("Recaps/index.md", { title: "Zed" }),
      page("Recaps/zz-first.md", { title: "Session 1" }),
    ], opts);
    const pages = entry!.patch["pages"] as Array<{ name: string; sort: number }>;
    assert.deepEqual(pages.map((p) => p.name), ["Zed", "Session 1", "Session 2", "Session 10"]);
    assert.deepEqual(pages.map((p) => p.sort), [100, 200, 300, 400]);
  });

  it("orders pages whose titles compare equal by path, whatever order they arrive in", () => {
    const pair = [page("NPCs/b.md", { title: "aldric" }), page("NPCs/a.md", { title: "Aldric" })];
    const ids = (pages: Page[]) => (journalEntries(pages, opts)[0]!.patch["pages"] as Array<{ _id: string }>).map((p) => p._id);
    assert.deepEqual(ids(pair), ids([...pair].reverse()));
    assert.deepEqual(ids(pair)[0], ids([pair[1]!])[0], "a.md first");
  });

  it("carries each page's body, rendered for that page", () => {
    const [entry] = journalEntries([page("Characters/Marlo.md")], opts);
    const pages = entry!.patch["pages"] as Array<Record<string, any>>;
    assert.equal(pages[0]!.text.content, "<p>Marlo</p>");
  });

  it("renders no body that no entry carries", () => {
    // A rendered body names its images for shipping, so one nobody carries ships files for nothing.
    const asked: string[] = [];
    const counting: GraftOptions = { ...opts, body: (p) => { asked.push(p.path); return ""; } };
    buildGrafts([
      page("Notes/Quiet.md", { foundry: { source: "Actor:npc", journal: false, embed: false } }),
      page("Maps/Keep.md", { foundry: { source: "Scene", journal: false } }),
    ], counting);
    assert.deepEqual(asked, []);
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
    assert.equal(pages[1]!.text.content, "<p>Secret</p>", "and the hidden one still carries a body");
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

describe("documents from foundry.source", () => {
  it("become a graft of what they are based on", () => {
    const { entries } = documentEntries([
      page("Characters/Marlo.md", {
        role: "dm",
        foundry: { source: "Compendium.some-bestiary.actors.Actor.mmBandit000000",
                   patch: { system: { attributes: { hp: { value: 45 } } } } },
      }),
    ], opts);

    assert.equal(entries[0]!.source, "Compendium.some-bestiary.actors.Actor.mmBandit000000");
    assert.equal(entries[0]!.type, "Actor");
    // The page's own value stands, with the dnd5e default for a description
    // filled in beside it rather than over it.
    const system = entries[0]!.patch["system"] as any;
    assert.deepEqual(system.attributes, { hp: { value: 45 } });
    assert.equal(system.details.biography.value, "<p>Marlo</p>");
    assert.equal((entries[0]!.patch["ownership"] as any).default, 0);
  });

  it("a page inventing its own document has no source", () => {
    const { entries } = documentEntries([
      page("Items/Sword.md", { foundry: { source: "Item", patch: { type: "weapon" } } }),
    ], opts);
    assert.ok(!("source" in entries[0]!), "absent means the patch is the document");
    assert.equal(entries[0]!.type, "Item");
  });

  it("names what it could not place rather than dropping it", () => {
    const { entries, warnings } = documentEntries([
      page("y.md", { foundry: { source: "nonsense" } }),
    ], opts);
    assert.deepEqual(entries, []);
    assert.match(warnings[0]!, /cannot tell what kind/);
  });
});

describe("grafting onto a sibling entry", () => {
  const sibling = (id: string) => `Actor.${id}`;
  const captain = page("Bestiary/Captain.md", {
    foundry: { source: "Compendium.some-bestiary.actors.Actor.mmCaptain000000", patch: { _id: "c4pta1n000000001" } },
  });
  const merchant = (source: string) => page("NPCs/Merchant.md", { foundry: { source } });

  it("names a sibling in this build by bare id, whichever pack it lands in", () => {
    const { entries, warnings } = documentEntries([captain, merchant(sibling("c4pta1n000000001"))], opts);
    assert.deepEqual(warnings, []);
    assert.equal(entries.find((e) => e.id !== "c4pta1n000000001")!.source, "c4pta1n000000001");
  });

  it("leaves a world UUID this build does not make exactly as written", () => {
    // It names a document the reader already has, which is a source like any
    // other. Dropping it would delete a legitimate graft target.
    const { entries, warnings } = documentEntries([merchant(sibling("c4pta1n000000001"))], opts);
    assert.deepEqual(warnings, []);
    assert.equal(entries[0]!.source, sibling("c4pta1n000000001"));
  });

  it("warns when the source names this build's own id at the wrong type, and leaves it as written", () => {
    // The build makes an Actor under that id. A bare id would quietly resolve to the wrong kind of document.
    const { entries, warnings } = documentEntries([captain, merchant("Item.c4pta1n000000001")], opts);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /c4pta1n000000001.*different document type/);
    assert.equal(entries.find((e) => e.id !== "c4pta1n000000001")!.source, "Item.c4pta1n000000001");
  });

  it("passes an own-vault embedded UUID through unchanged", () => {
    const embedded = "Compendium.some-bestiary.actors.Actor.mmCaptain000000.Item.itemAAAAAAAAAAAA";
    const { entries, warnings } = documentEntries([captain, merchant(embedded)], opts);
    assert.deepEqual(warnings, []);
    assert.equal(entries.find((e) => e.id !== "c4pta1n000000001")!.source, embedded);
  });

  it("warns when two pages pin one id", () => {
    const pin = (path: string) => page(path, { foundry: { source: "Actor:npc", patch: { _id: "duplicate0000001" } } });
    const { warnings } = documentEntries([pin("A.md"), pin("B.md")], opts);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /B\.md.*duplicate0000001.*also pinned/);
  });

  it("says nothing about a source outside this vault", () => {
    const { warnings } = documentEntries([
      page("NPCs/Guard.md", { foundry: { source: "Compendium.some-bestiary.actors.Actor.mmGuard000000000" } }),
    ], opts);
    assert.deepEqual(warnings, []);
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
  it("folds a bare type's case, which Foundry's UUID lookup will not", () => {
    // `source: actor:npc` is supported; "actor" passed through as a distinct
    // type once split a mixed-case list and dropped the whole source.
    assert.equal(documentTypeOf("actor:npc"), "Actor");
    assert.equal(documentTypeOf("rolltable"), "RollTable");
  });
  it("refuses anything else", () => {
    assert.equal(documentTypeOf("Compendium.too.short"), null);
    assert.equal(documentTypeOf("NotADocType"), null);
    assert.equal(documentTypeOf(""), null);
  });
});

describe("the whole file", () => {
  it("writes format 4", () => {
    const { file } = buildGrafts([page("A/B.md")], opts);
    assert.equal(file.format, 4);
    assert.equal(file.entries.length, 1);
  });

});

describe("where a folder's own entry files", () => {
  const at = (entries: any[], name: string) =>
    entries.find((e) => e.patch.name === name)?.folder;

  it("puts it inside its own folder, beside the subfolders it indexes", () => {
    // Otherwise the entry holding a folder's index sits next to the Foundry
    // folder rather than in it, which reads as two unrelated things.
    const entries = journalEntries([
      page("NPCs/Bram.md"), page("NPCs/Solaris/Pit.md"),
    ], opts);
    assert.equal(at(entries, "NPCs"), "NPCs");
    assert.equal(at(entries, "Solaris"), "NPCs");
  });

  it("leaves a leaf beside its siblings, so no folder holds one entry", () => {
    const entries = journalEntries([page("NPCs/Bram.md")], opts);
    assert.equal(at(entries, "NPCs"), undefined, "a leaf got a folder of its own");
  });

  it("reaches an ancestor whose own folder holds no pages", () => {
    // "Deep" has no notes of its own; its folder still exists because
    // something sits below it.
    const entries = journalEntries([page("A/Deep/Down/x.md"), page("A/y.md")], opts);
    assert.equal(at(entries, "A"), "A");
    assert.equal(at(entries, "Down"), "A/Deep");
  });

  it("leaves the root entry at the root", () => {
    const entries = journalEntries([page("Home.md"), page("NPCs/Bram.md")], opts);
    assert.equal(at(entries, "Home"), undefined);
  });
});

describe("document ownership", () => {
  // playerRole is "player", so a public page is one players may read.
  const npc = (patch: Record<string, unknown> = {}) => page("NPCs/Bram.md", {
    role: "public", foundry: { source: "Actor:npc", patch },
  });

  it("builds a public page's document GM-only", () => {
    // Reading a page on the wiki does not make the NPC it builds the players'.
    const { entries } = documentEntries([npc()], opts);
    assert.equal((entries[0]!.patch["ownership"] as any).default, 0);
  });

  it("lets the page's own patch make its document visible", () => {
    const { entries } = documentEntries([npc({ ownership: { default: 2 } })], opts);
    assert.equal((entries[0]!.patch["ownership"] as any).default, 2);
  });

  it("still opens the same page's journal page to players", () => {
    // Role-based visibility is the journal's, and only the journal's.
    const [entry] = journalEntries([npc()], opts);
    const pages = entry!.patch["pages"] as Array<Record<string, any>>;
    assert.equal(pages[0]!.ownership.default, 2);
  });
});

describe("visibility", () => {
  it("only offers a role the pages it may see", async () => {
    const metas = [
      { path: "A.md", title: "A", role: "public" },
      { path: "B.md", title: "B", role: "dm", frontmatter: { foundry: { source: "Actor" } } },
    ];
    assert.deepEqual(pagesFrom(metas, new Set(["public"])).map((p) => p.path), ["A.md"]);
    const all = pagesFrom(metas, new Set(["public", "dm"]));
    assert.equal(all.length, 2);
    assert.deepEqual(all[1]!.foundry, { source: "Actor" });
  });
});

describe("foundry.source names one document", () => {
  it("builds no document from a list, and says why", () => {
    const listed: Page = {
      path: "x.md", title: "X", role: "dm",
      foundry: { source: ["Compendium.a.b.Actor.aaaaaaaaaaaaaaaa", "Compendium.c.d.Actor.bbbbbbbbbbbbbbbb"] },
    };
    const { entries, warnings } = documentEntries([listed], opts);
    assert.deepEqual(entries, []);
    assert.match(warnings[0]!, /x\.md: foundry\.source is a list; name one document\. No document was built/);
    assert.equal(linkIndex([listed], opts).targets.get("x.md")!.doc, undefined, "and nothing links to one");
  });

  it("reads a string, trimmed, and nothing else", () => {
    assert.equal(sourceOf("  Compendium.a.b.Actor.aaaaaaaaaaaaaaaa "), "Compendium.a.b.Actor.aaaaaaaaaaaaaaaa");
    for (const not of [42, [], ["Compendium.a.b.Actor.aaaaaaaaaaaaaaaa"], { uuid: "x" }, "  ", undefined]) assert.equal(sourceOf(not), null);
  });
});

describe("a bare base with a subtype", () => {
  it("splits the schema from the kind", async () => {
    // `Actor:npc` is a page inventing an NPC rather than grafting one: Actor
    // is the schema graft builds into, npc is a field on the document.
    assert.equal(documentTypeOf("Actor:npc"), "Actor");
    assert.equal(subtypeOf("Actor:npc"), "npc");
    assert.equal(subtypeOf("Compendium.a.b.Actor.cccccccccccccccc"), null, "a source carries its own");

    const { entries, warnings } = documentEntries([{
      path: "NPCs/Mossroot.md", title: "Mossroot", role: "dm", foundry: { source: "Actor:npc" },
    }], opts);
    assert.deepEqual(warnings, []);
    assert.equal(entries[0]!.type, "Actor");
    assert.equal(entries[0]!.patch["type"], "npc");
    assert.ok(!("source" in entries[0]!), "invented, not grafted");
  });
});

describe("an unset player role", () => {
  it("publishes nothing, rather than defaulting to the lowest role", async () => {
    // "Empty means none of it is [player-visible]" is what the setting
    // documents, and it is the only safe reading: a vault that has not opted
    // in must not put content in front of the table.
    const shut = { ...opts, playerRole: "" };

    assert.equal(observable(page("A.md", { role: "public" }), shut), false);
    const [entry] = journalEntries([page("A.md", { role: "public" })], shut);
    assert.equal((entry!.patch["ownership"] as any).default, 0);
  });
});

describe("pagesFrom and the sidecar", () => {
  // A Scene's walls, tiles and background live in the file `foundry.patch_json`
  // points at, not in the page's frontmatter. Before this was wired in, such a
  // page compiled to a name and an ownership and nothing else, and the build
  // said nothing: you found out by importing an empty map.
  const meta = (path: string, foundry: unknown) => ({
    path, title: path.replace(/\.md$/, "").split("/").pop()!, role: "dm",
    frontmatter: { foundry } as Record<string, unknown>,
  });
  const visible = new Set(["dm"]);

  it("carries the sidecar beside the inline patch, not over it", () => {
    // Two different statements. The sidecar is what an export happened to
    // hold; the inline patch is what somebody typed on purpose.
    const patches = new Map([["Scenes/River.md", { walls: [{ _id: "w1" }], width: 2240 }]]);
    const [page] = pagesFrom(
      [meta("Scenes/River.md", { source: "Scene", patch_json: "s/river.json", patch: { name: "River" } })],
      visible, patches);
    assert.deepEqual(page!.sidecar, { walls: [{ _id: "w1" }], width: 2240 });
    assert.deepEqual(page!.foundry!.patch, { name: "River" });
  });

  it("leaves a page with no sidecar on its inline patch alone", () => {
    const [page] = pagesFrom(
      [meta("Actors/Marlo.md", { source: "Actor:npc", patch: { name: "Marlo" } })], visible, new Map());
    assert.deepEqual(page!.foundry!.patch, { name: "Marlo" });
    assert.equal(page!.sidecar, undefined);
  });

  it("does not mutate the frontmatter it was handed", () => {
    // The same meta objects are read again for every other variant.
    const fm = { source: "Scene", patch: { name: "keep" } };
    const m = meta("Scenes/River.md", fm);
    pagesFrom([m], visible, new Map([["Scenes/River.md", { walls: [] }]]));
    assert.deepEqual(fm.patch, { name: "keep" });
  });

  it("works when no patch map is supplied at all", () => {
    const [page] = pagesFrom([meta("Actors/Marlo.md", { source: "Actor:npc" })], visible);
    assert.equal(page!.foundry!.source, "Actor:npc");
  });
});

describe("asset references name where the file lands", () => {
  // Every reference in a variant's grafts.json names that variant's own
  // deploy: it is the only one the reader's token is guaranteed to fetch.
  // What keeps a DM asset from a player is not the path an entry names but
  // that the player's own grafts.json never lists the DM page, so its `assets`
  // block never names the file and nothing fetches it.
  const withToken = (role: string): Page => ({
    path: `Bestiary/${role}.md`, title: role, role,
    foundry: { source: "Actor:npc", patch: { prototypeToken: { texture: { src: "@vault/t/x.webp" } } } },
  });

  const srcOf = (p: Page) => {
    const [entry] = documentEntries([p], opts).entries;
    const token = entry!.patch["prototypeToken"] as Record<string, any>;
    return token["texture"]["src"] as string;
  };

  it("names where the file lands, whatever role the page has", () => {
    assert.equal(srcOf(withToken("player")), "vaults/marlo/t/x.webp");
    assert.equal(srcOf(withToken("dm")), "vaults/marlo/t/x.webp");
  });

});

describe("_stats.coreVersion", () => {
  // Foundry requires it on every document and supplies nothing when it is
  // absent: strict validation fails with "coreVersion: may not be undefined",
  // the import errors, and graft builds a loose copy instead. That copy is not
  // the document — a Scene arrives having lost every level — and until graft
  // learned to warn, the build reported success.
  //
  // Verified against Foundry 14.359's own BaseScene.fromSource: without it the
  // six-level source threw; with any non-empty value all six levels and their
  // backgrounds survived. The value decides which migration runs, not whether
  // the document is accepted.
  const opts2: GraftOptions = { ...opts, coreVersion: "14" };
  // An Actor rather than a Scene only because the fixture declares an Actor
  // pack; the requirement is the same for every document type.
  const doc = (patch: Record<string, unknown> = {}): Page => ({
    path: "Bestiary/Wolf.md", title: "Wolf", role: "dm",
    foundry: { source: "Actor:npc", patch },
  });

  it("stamps every entry, documents and journals alike", () => {
    const { file } = buildGrafts([doc(), page("Notes/A.md")], opts2);
    assert.ok(file.entries.length >= 2);
    for (const e of file.entries) {
      assert.equal((e.patch["_stats"] as any).coreVersion, "14", e.type);
    }
  });

  it("carries the full version, which is what Foundry's migrations compare", () => {
    // Not the generation. Foundry registers migrations at patch versions —
    // `migrateLevels` at 14.353 — and sorts a bare "14" before all of them, so
    // a v14 Scene stamped "14" is migrated as though it were v13 and loses
    // every level it had. Settings warns about this; here it just travels.
    const { file } = buildGrafts([doc()], { ...opts, coreVersion: "14.359" });
    assert.equal((file.entries[0]!.patch["_stats"] as any).coreVersion, "14.359");
  });

  it("keeps a version the exported sidecar already carried", () => {
    const { file } = buildGrafts([doc({ _stats: { coreVersion: "12.331" } })], opts2);
    const actor = file.entries.find((e) => e.type === "Actor")!;
    assert.equal((actor.patch["_stats"] as any).coreVersion, "12.331");
  });

  it("keeps the rest of an existing _stats", () => {
    const { file } = buildGrafts([doc({ _stats: { compendiumSource: "Compendium.a.b.Actor.c" } })], opts2);
    const actor = file.entries.find((e) => e.type === "Actor")!;
    assert.equal((actor.patch["_stats"] as any).compendiumSource, "Compendium.a.b.Actor.c");
    assert.equal((actor.patch["_stats"] as any).coreVersion, "14");
  });

  it("invents no version when the vault has not said", () => {
    // Warning about it is the build's job, once for the vault; this file is
    // called once per role and would say it three times for a three-role vault.
    const { file } = buildGrafts([doc()], opts);
    assert.equal(file.entries[0]!.patch["_stats"], undefined);
  });

  it("leaves an entry with a compendium source alone", () => {
    // The document is mostly the compendium's, and the reader's copy of that
    // already records what it was written for. Ours would overwrite it with an
    // older value and re-run migrations it has been through.
    const sourced: Page = {
      path: "Bestiary/Mage.md", title: "Mage", role: "dm",
      foundry: { source: "Compendium.dnd5e.actors24.Actor.mmMage0000000000" },
    };
    const { file } = buildGrafts([sourced], opts2);
    const actor = file.entries.find((e) => e.type === "Actor")!;
    assert.equal(actor.patch["_stats"], undefined);
  });
});

describe("the page keys sync, journal, embed and folder", () => {
  const doc = (foundry: Page["foundry"], path = "DM Notes/Scenes/Home.md"): Page =>
    ({ path, title: "Home", role: "dm", foundry });

  it("sync: false keeps the page out of Foundry entirely", () => {
    const p = doc({ source: "Scene", sync: false });
    assert.deepEqual(documentEntries([p], opts).entries, []);
    assert.equal(journalEntries([p], opts).length, 0);
    assert.equal(linkIndex([p], opts).targets.has(p.path), false);
  });

  it("journal: false makes the document but no journal page", () => {
    const p = doc({ source: "Scene", journal: false });
    assert.equal(documentEntries([p], opts).entries.length, 1);
    assert.equal(journalEntries([p], opts).length, 0);
  });

  it("journal: false points links at the document instead", () => {
    // The journal page a link would name does not exist, and the page still
    // has something a reader can be sent to.
    const p = doc({ source: "Scene", journal: false, patch: { _id: "marloHomeScene00" } });
    const target = linkIndex([p], opts).targets.get(p.path)!;
    assert.deepEqual(target, { doc: { type: "Scene", id: "marloHomeScene00" } });
  });

  it("embed: false keeps the page's prose out of the description", () => {
    const p: Page = {
      path: "Bestiary/Wolf.md", title: "Wolf", role: "dm",
      image: "/a/wolf.webp", foundry: { source: "Actor:npc", embed: false },
    };
    const patch = documentEntries([p], opts).entries[0]!.patch;
    assert.equal((patch as any).system?.details?.biography, undefined);
    assert.match(String(patch["img"]), /wolf/, "the art default still applies");
  });

  it("folder places the document where the page says, not where it lives", () => {
    const p = doc({ source: "Scene", folder: "Shopping Districts" });
    assert.equal(documentEntries([p], opts).entries[0]!.folder, "Shopping Districts");
  });
});

describe("map-note references", () => {

  it("fills a note's journal ids from the page path it names", () => {
    const p: Page = {
      path: "DM Notes/Scenes/Home.md", title: "Home", role: "dm",
      foundry: { source: "Scene" },
      sidecar: { notes: [{ entryId: "@vault/Places/Arlanton", pageId: "staleOldId000000", x: 1 }] },
    };
    const [entry] = documentEntries([p], opts).entries;
    const [note] = (entry!.patch["notes"] as Array<Record<string, unknown>>);
    assert.equal(note!["entryId"], entryId("marlo", "Places"));
    assert.equal(note!["pageId"], pageId("marlo", "Places/Arlanton.md"));
    assert.equal(note!["x"], 1, "the rest of the note is untouched");
  });

  it("accepts the path with or without .md", () => {
    const p: Page = {
      path: "S.md", title: "S", role: "dm",
      foundry: { source: "Scene", patch: { notes: [{ entryId: "@vault/Places/Arlanton.md" }] } },
    };
    const [entry] = documentEntries([p], opts).entries;
    const [note] = (entry!.patch["notes"] as Array<Record<string, unknown>>);
    assert.equal(note!["pageId"], pageId("marlo", "Places/Arlanton.md"));
  });

  it("warns when a note names a page that is not in the build", () => {
    const p: Page = {
      path: "S.md", title: "S", role: "dm",
      foundry: { source: "Scene", patch: { notes: [{ entryId: "@vault/Nowhere/Gone" }] } },
    };
    const { warnings } = documentEntries([p], opts);
    assert.ok(warnings.some((w) => w.includes("Nowhere/Gone")), warnings.join("; "));
  });

  it("fills a token's actorId from the actor page it names, pinned id and all", () => {
    // Tokens on a title-card scene, actor-linked to premade PCs. The old
    // sync's ids matched nothing and every click said the actor no longer
    // exists.
    const macy: Page = {
      path: "Actors/Macy Arla.md", title: "Macy Arla", role: "dm",
      foundry: { source: "Actor:character", patch: { _id: "marloMacyArla000" } },
    };
    const scene: Page = {
      path: "S.md", title: "S", role: "dm",
      foundry: { source: "Scene", patch: { tokens: [
        { name: "Macy", actorId: "@vault/Actors/Macy Arla", actorLink: true },
        { name: "Wolf", actorId: "@vault/Bestiary/Wolf" },
      ] } },
    };
    const { entries } = documentEntries([macy, scene], opts);
    const tokens = entries.find((e) => e.type === "Scene")!.patch["tokens"] as Array<Record<string, unknown>>;
    assert.equal(tokens[0]!["actorId"], "marloMacyArla000", "pinned id wins");
    assert.equal(tokens[1]!["actorId"], instanceId("marlo", "Bestiary/Wolf.md"), "derived otherwise");
  });

  it("never writes resolved ids back into the page's own frontmatter", () => {
    // The patch is shared by every variant's build. Resolved in place by the
    // player build, the DM build would see no reference left to resolve and
    // miss the actor's pinned id — a token on the GM's map pointing nowhere.
    const macy: Page = {
      path: "Actors/Macy Arla.md", title: "Macy Arla", role: "dm",
      foundry: { source: "Actor:character", patch: { _id: "marloMacyArla000" } },
    };
    const patch = { tokens: [{ name: "Macy", actorId: "@vault/Actors/Macy Arla" }] };
    const scene: Page = { path: "S.md", title: "S", role: "public", foundry: { source: "Scene", patch } };
    documentEntries([scene], opts);          // the player's build, no Macy
    const dm = documentEntries([macy, scene], opts);
    const tokens = dm.entries.find((e) => e.type === "Scene")!.patch["tokens"] as Array<Record<string, unknown>>;
    assert.equal(tokens[0]!["actorId"], "marloMacyArla000");
    assert.equal(patch.tokens[0]!.actorId, "@vault/Actors/Macy Arla", "frontmatter untouched");
  });

  it("warns when a token names a page that makes no document, or a note a page with no journal page", () => {
    const prose: Page = { path: "Notes/Lore.md", title: "Lore", role: "dm" };
    const macro: Page = { path: "Macros/M.md", title: "M", role: "dm", foundry: { source: "Macro", journal: false } };
    const scene: Page = {
      path: "S.md", title: "S", role: "dm",
      foundry: { source: "Scene", patch: {
        tokens: [{ actorId: "@vault/Notes/Lore" }],
        notes: [{ entryId: "@vault/Macros/M" }],
      } },
    };
    const { warnings } = documentEntries([prose, macro, scene], opts);
    assert.ok(warnings.some((w) => w.includes("Notes/Lore.md") && w.includes("no document")), warnings.join("; "));
    assert.ok(warnings.some((w) => w.includes("Macros/M.md") && w.includes("no journal page")), warnings.join("; "));
  });

  it("leaves a note that already carries plain ids alone", () => {
    const p: Page = {
      path: "S.md", title: "S", role: "dm",
      foundry: { source: "Scene", patch: { notes: [{ entryId: "abcdabcdabcdabcd", pageId: "x" }] } },
    };
    const [entry] = documentEntries([p], opts).entries;
    const [note] = (entry!.patch["notes"] as Array<Record<string, unknown>>);
    assert.equal(note!["entryId"], "abcdabcdabcdabcd");
  });
});

describe("document artwork", () => {
  // A page that shows a portrait should make a document that shows the same
  // portrait. Four of this vault's actors shipped with
  // `systems/dnd5e/icons/svg/actors/character.svg` in their exported sidecar —
  // the system placeholder, not a choice — so a rule of "the patch always
  // wins" leaves them blank-faced next to a page with their picture on it.
  const withImage = (over: Partial<Page> = {}): Page => ({
    path: "Actors/Marlo.md", title: "Marlo", role: "dm",
    image: "/attachments/npcs/Marlo%20Vex.webp",
    foundry: { source: "Actor:npc" }, ...over,
  });
  const artOf = (page: Page) => documentEntries([page], opts).entries[0]!.patch;

  it("uses the page's image as the document's art", () => {
    assert.equal(artOf(withImage())["img"], "vaults/marlo/attachments/npcs/Marlo%20Vex.webp");
  });

  it("loses to a sidecar, which is the page's data too", () => {
    // One rule, no exceptions: defaults < sidecar < inline patch. An export
    // that names a real icon means it. An export that carries the system's
    // placeholder is a bare template, and that is a content problem — the
    // placeholder comes out of the sidecar, not out of the merge order.
    const p = withImage({ sidecar: { img: "icons/tools/instruments/lute-gold-brown.webp" } });
    assert.equal(artOf(p)["img"], "icons/tools/instruments/lute-gold-brown.webp");
  });

  it("fills in for a sidecar that names no art", () => {
    const p = withImage({ sidecar: { system: { attributes: {} } } });
    assert.match(String(artOf(p)["img"]), /Marlo%20Vex/);
  });

  it("loses to art the page itself declares", () => {
    const p = withImage({ foundry: { source: "Actor:npc", patch: { img: "icons/svg/mystery-man.svg" } } });
    assert.equal(artOf(p)["img"], "icons/svg/mystery-man.svg");
  });

  it("never lets an _id ride along in the patch", () => {
    // The entry's id is the one that counts: graft stamps it over whatever the
    // patch carries, so an `_id` left in the patch only misstates where it lands.
    const p = withImage({ foundry: { source: "Actor:npc", patch: { _id: "short" } } });
    assert.equal(artOf(p)["_id"], undefined);
    assert.match(documentEntries([p], opts).entries[0]!.id, /^[a-f0-9]{16}$/);
  });

  it("defaults an Actor's token from the same image", () => {
    const token = artOf(withImage())["prototypeToken"] as any;
    assert.equal(token.texture.src, "vaults/marlo/attachments/npcs/Marlo%20Vex.webp");
  });

  it("never overwrites token art the page already has", () => {
    // A token is cut round and padded; a portrait is not. Dropping a portrait
    // into a token ring is exactly the wrong picture.
    const p = withImage({ foundry: { source: "Actor:npc", patch: { prototypeToken: { texture: { src: "@vault/t/marlo.token.webp" }, actorLink: true } } } });
    const token = artOf(p)["prototypeToken"] as any;
    assert.match(token.texture.src, /marlo\.token\.webp/);
    assert.equal(token.actorLink, true, "the rest of the token config survives");
  });

  it("gives a non-Actor no token", () => {
    const p = withImage({ path: "Items/Ring.md", foundry: { source: "Item:loot" } });
    const patch = documentEntries([p], opts).entries[0]!.patch;
    assert.equal(patch["prototypeToken"], undefined);
    assert.match(String(patch["img"]), /Marlo%20Vex/);
  });

  it("passes an external image straight through", () => {
    const p = withImage({ image: "https://example.com/a.webp" });
    assert.equal(artOf(p)["img"], "https://example.com/a.webp");
  });

  it("adds nothing when the page has no image", () => {
    const p = withImage({ image: null });
    assert.equal(artOf(p)["img"], undefined);
    assert.equal(artOf(p)["prototypeToken"], undefined);
  });
});

describe("what the patch can say for itself", () => {
  // Facts about a document belong in the document. `foundry.id` and
  // `foundry.embed` were sibling keys describing the patch from outside it,
  // and the emitter silently ignored both once the graft path landed.
  const doc = (patch: Record<string, unknown>, over: Partial<Page> = {}): Page => ({
    path: "Scenes/Home.md", title: "Home", role: "dm",
    foundry: { source: "Scene", patch }, ...over,
  });
  const entryFor = (p: Page) => documentEntries([p], opts);

  it("pins a document id from patch._id", () => {
    const { entries } = entryFor(doc({ _id: "marloHomeScene00" }));
    assert.equal(entries[0]!.id, "marloHomeScene00");
  });

  it("keeps a sidecar's own _id out of the patch", () => {
    // Every Scene exported from Foundry carries the id it had in that world,
    // which is not the deterministic one the entry was given.
    const p = doc({}, { sidecar: { _id: "sidecarSceneId01", width: 2240 } });
    const { entries } = entryFor(p);
    assert.equal(entries[0]!.patch["_id"], undefined);
    assert.match(entries[0]!.id, /^[a-f0-9]{16}$/);
    assert.equal(entries[0]!.patch["width"], 2240, "the rest of the sidecar still lands");
  });

  it("refuses an id Foundry would reject, and says so", () => {
    // Passing it on means a document Foundry declines and a page that simply
    // never appears, with nothing naming the reason.
    for (const bad of ["short", "way-too-long-for-an-id", "has spaces here!", 42]) {
      const { entries, warnings } = entryFor(doc({ _id: bad }));
      assert.match(entries[0]!.id, /^[a-f0-9]{16}$/, String(bad));
      assert.ok(warnings.some((w) => w.includes("_id")), String(bad));
    }
  });

  it("lets a page turn off derived art with img: null", () => {
    // The off-switch an automatic enrichment needs, in the vocabulary the
    // patch already has: null is how merge-patch spells "explicitly nothing".
    const page = doc({ img: null }, { image: "/a/portrait.webp" });
    const patch = entryFor(page).entries[0]!.patch;
    assert.equal(patch["img"], null);
  });
});

describe("withFolderIndexes", () => {
  const roles = ["public", "dm"];

  it("gives a folder without an index the page the wiki would have synthesized", () => {
    const out = withFolderIndexes([page("Places/Arlanton.md", { role: "public" })], roles);
    const idx = out.find((p) => p.path === "Places/index.md");
    assert.ok(idx, "synthesized");
    assert.equal(idx!.title, "Places");
    assert.equal(idx!.role, "public");
  });

  it("takes the lowest role among the folder's pages", () => {
    // A folder with any player-visible page gets a player-visible index; a
    // DM-only folder stays DM-only.
    const out = withFolderIndexes([
      page("Places/Arlanton.md", { role: "public" }),
      page("Places/Lair.md", { role: "dm" }),
      page("DM Notes/Plans.md", { role: "dm" }),
    ], roles);
    assert.equal(out.find((p) => p.path === "Places/index.md")!.role, "public");
    assert.equal(out.find((p) => p.path === "DM Notes/index.md")!.role, "dm");
  });

  it("never shadows a real index page", () => {
    const out = withFolderIndexes([
      page("Actors/index.md"), page("Actors/Bixby.md"),
    ], roles);
    assert.equal(out.filter((p) => p.path === "Actors/index.md").length, 1);
  });

  it("covers ancestor folders too", () => {
    const out = withFolderIndexes([page("DM Notes/Scenes/Home.md")], roles);
    assert.ok(out.some((p) => p.path === "DM Notes/index.md"));
    assert.ok(out.some((p) => p.path === "DM Notes/Scenes/index.md"));
  });
});

describe("withItemIds", () => {
  const stamp = (patch: Record<string, unknown>) => withItemIds(patch, "southaven", "NPCs/Baldrin.md");

  it("becomes a graft of the item it names, which is what graft expands", () => {
    // Left as `{uuid, ...}` graft leaves it alone, and Foundry rejects an item
    // with no name and no type. The `_id` is also what keys the array, without
    // which the whole items array replaces the source's instead of merging.
    const out = stamp({ items: [{ uuid: "Compendium.kctg.p.Item.abc", system: { quantity: 40 } }] });
    const items = out["items"] as Record<string, unknown>[];
    assert.equal(items[0]!["_id"], itemId("southaven", "NPCs/Baldrin.md", "Compendium.kctg.p.Item.abc:0"));
    assert.equal(items[0]!["source"], "Compendium.kctg.p.Item.abc");
    assert.deepEqual(items[0]!["patch"], { system: { quantity: 40 } });
    assert.equal(items[0]!["uuid"], undefined, "the authoring key must not survive into the entry");
  });

  it("leaves a uuid deeper in the patch alone: a grant is offered, not placed", () => {
    // An advancement's configuration.items[] is a list of what the feature
    // grants, not documents to create.
    const grant = { configuration: { items: [{ uuid: "Compendium.dnd5e.p.Item.xyz" }] } };
    assert.deepEqual(stamp(grant), grant);
  });

  it("leaves an id the page pinned itself alone", () => {
    const out = stamp({ items: [{ _id: "uXeL0cGWqRTReue0", flags: { hidden: true } }] });
    assert.equal((out["items"] as Record<string, unknown>[])[0]!["_id"], "uXeL0cGWqRTReue0");
  });

  it("makes a mixed array wholly keyed, which is the case that broke", () => {
    const out = stamp({ items: [
      { uuid: "Compendium.kctg.p.Item.abc", system: { quantity: 40 } },
      { _id: "uXeL0cGWqRTReue0" },
    ] });
    const items = out["items"] as Record<string, unknown>[];
    assert.ok(items.every((i) => typeof i["_id"] === "string"));
  });

  it("keys by uuid, so reordering the list moves no id", () => {
    const a = stamp({ items: [{ uuid: "Item.a" }, { uuid: "Item.b" }] })["items"] as Record<string, unknown>[];
    const b = stamp({ items: [{ uuid: "Item.b" }, { uuid: "Item.a" }] })["items"] as Record<string, unknown>[];
    assert.equal(a[0]!["_id"], b[1]!["_id"]);
    assert.equal(a[1]!["_id"], b[0]!["_id"]);
  });

  it("separates two stacks of the same item", () => {
    const items = stamp({ items: [{ uuid: "Item.a" }, { uuid: "Item.a" }] })["items"] as Record<string, unknown>[];
    assert.notEqual(items[0]!["_id"], items[1]!["_id"]);
  });

  it("ignores a patch with no items array", () => {
    const patch = { name: "Baldrin" };
    assert.equal(stamp(patch), patch);
  });
});

describe("withEmbeddedIds", () => {
  const stamp = (patch: Record<string, unknown>, type = "Scene") =>
    withEmbeddedIds(patch, type, "southaven", "Scenes/Market.md");
  const members = (patch: Record<string, unknown>, field: string) =>
    patch[field] as Record<string, unknown>[];

  it("keys a scene note, which Foundry would otherwise re-mint every build", () => {
    // A random id each build means the scene never matches what was stored,
    // and graft replaces the whole collection instead of merging it.
    const out = stamp({ notes: [{ entryId: "aaaaaaaaaaaaaaaa", x: 350 }] });
    assert.equal(members(out, "notes")[0]!["_id"],
      itemId("southaven", "Scenes/Market.md", "notes:0"));
    assert.equal(members(out, "notes")[0]!["x"], 350);
  });

  it("keys every collection the type has, not just the first", () => {
    const out = stamp({ notes: [{ x: 1 }], tokens: [{ name: "Cassira" }] });
    assert.notEqual(members(out, "tokens")[0]!["_id"], members(out, "notes")[0]!["_id"]);
  });

  it("leaves an id the author wrote alone", () => {
    const out = stamp({ levels: [{ _id: "defaultLevel0000", name: "Ground" }] });
    assert.equal(members(out, "levels")[0]!["_id"], "defaultLevel0000");
  });

  it("does not touch an array that is not an embedded collection", () => {
    // Card.faces is a plain array of objects, so shape alone cannot decide.
    const faces = [{ name: "Ace" }];
    assert.deepEqual(stamp({ faces }, "Cards")["faces"], faces);
  });

  it("is stable across builds and distinct between pages", () => {
    const one = stamp({ notes: [{ x: 1 }] });
    const again = stamp({ notes: [{ x: 1 }] });
    const elsewhere = withEmbeddedIds({ notes: [{ x: 1 }] }, "Scene", "southaven", "Scenes/Docks.md");
    assert.equal(members(one, "notes")[0]!["_id"], members(again, "notes")[0]!["_id"]);
    assert.notEqual(members(one, "notes")[0]!["_id"], members(elsewhere, "notes")[0]!["_id"]);
  });
});

const SCENE = "@moulinette/13648/json/scene/junkyard.json";
const MAP = "@moulinette/13648/images/maps/junkyard.webp";
const junkyard = (foundry: Record<string, unknown>, over: Partial<Page> = {}): Page =>
  ({ path: "Scenes/Junkyard.md", title: "Junkyard", role: "dm", foundry, ...over });

describe("a source that is a file on the reader's machine", () => {
  it("takes its document type from foundry.type", () => {
    const page = junkyard({ source: "graft/my-pack/junkyard.json", type: "scene", patch: { navName: "Junkyard" } });
    const { entries, warnings } = documentEntries([page], opts);
    assert.deepEqual(warnings, []);
    assert.equal(entries[0]!.type, "Scene");
    assert.equal(entries[0]!.source, "graft/my-pack/junkyard.json");
    assert.equal(linkIndex([page], opts).targets.get(page.path)!.doc!.type, "Scene", "and is linked to as the document it builds");
  });

  it("builds nothing without one, and says what to add", () => {
    const { entries, warnings } = documentEntries([junkyard({ source: SCENE })], opts);
    assert.deepEqual(entries, []);
    assert.match(warnings[0]!, /does not say what it holds\. State it as foundry\.type/);
  });

  it("names the types it builds when foundry.type is not one", () => {
    const { entries, warnings } = documentEntries([junkyard({ source: SCENE, type: "Combat" })], opts);
    assert.deepEqual(entries, []);
    assert.match(warnings[0]!, /foundry\.type "Combat" is not a document type.*Scene/);
  });

  it("reads foundry.type for a file only, so it cannot rescue a UUID the build refuses", () => {
    assert.equal(pageDocumentType({ source: "Compendium.a.b.Actor.aaaaaaaaaaaaaaaa", type: "Scene" }), "Actor");
    assert.equal(pageDocumentType({ source: "Compendium.a.b.Combat.aaaaaaaaaaaaaaaa", type: "Scene" }), null);
    assert.equal(pageDocumentType({ source: "Compendium.a.b", type: "Scene" }), null);
    assert.equal(pageDocumentType({ source: "Combat.aaaaaaaaaaaaaaaa", type: "Scene" }), null);
    assert.equal(pageDocumentType({ source: "Scen", type: "Scene" }), null, "a typo of a type is not a file");
    assert.equal(pageDocumentType({ type: "Scene" }), null, "a type alone names no document");
  });

  it("says so when foundry.type disagrees with a source that says what it is", () => {
    for (const [source, type] of [["Actor.aaaaaaaaaaaaaaaa", "Item"], ["Actor:npc", "Scene"], ["Actor.aaaaaaaaaaaaaaaa", "Combat"]] as const) {
      const { entries, warnings } = documentEntries([junkyard({ source, type })], opts);
      assert.equal(entries[0]!.type, "Actor");
      assert.match(warnings[0]!, new RegExp(`foundry\\.type "${type}" is ignored`), `${source} with ${type}`);
    }
    assert.deepEqual(documentEntries([junkyard({ source: "Actor:npc", type: "actor" })], opts).warnings, [], "agreeing is not worth a warning");
  });

  it("reads a file source whatever the case of its extension, as graft does", () => {
    assert.equal(pageDocumentType({ source: "graft/my-pack/YARD.JSON", type: "Scene" }), "Scene");
  });

  it("reads no subtype out of a file path", () => {
    assert.equal(subtypeOf("maps/scene:big.json"), null);
  });

  it("refuses a source written with @ that is not a Moulinette document, before asking for a type", () => {
    for (const source of ["@vault/Scenes/a.json", "@moulinette/abc/a.json", "@moulinette/1/a.webp", "@moulinette/1/../../worlds/w/a.json"]) {
      const { entries, warnings } = documentEntries([junkyard({ source })], opts);
      assert.deepEqual(entries, [], source);
      assert.equal(warnings.length, 1, source);
      assert.match(warnings[0]!, /names no document\..*No document was built for this page/, source);
    }
  });

  it("lets a token name an actor page built on a file", () => {
    const actor: Page = { path: "Actors/Rat.md", title: "Rat", role: "dm", foundry: { source: "graft/my-pack/rat.json", type: "Actor" } };
    const scene = junkyard({ source: "Scene", patch: { tokens: [{ name: "Rat", actorId: "@vault/Actors/Rat" }] } });
    const { entries, warnings } = documentEntries([actor, scene], opts);
    const tokens = entries.find((e) => e.type === "Scene")!.patch["tokens"] as Array<Record<string, unknown>>;
    assert.equal(tokens[0]!["actorId"], instanceId("marlo", "Actors/Rat.md"));
    assert.deepEqual(warnings, [], "the actor page was not counted as making a document");
  });
});

describe("a Moulinette reference", () => {
  it("becomes the path its file is placed at, and a file for graft-moulinette to place there", () => {
    const page = junkyard({ source: SCENE, type: "Scene", patch: {
      background: { src: MAP },
      tiles: [{ texture: { src: MAP } }, { texture: { src: "@moulinette/9021/images/tiles/crate.webp" } }],
      navName: `see ${MAP}`,
    } }, { sidecar: { sounds: [{ path: "@moulinette/9021/audio/drip.ogg" }] } });
    const { file, warnings } = buildGrafts([page], opts);
    assert.deepEqual(warnings, []);
    assert.deepEqual(file.assets, { moulinette: { files: [
      { source: "9021/audio/drip.ogg", destination: "graft/moulinette/9021/audio/drip.ogg" },
      { source: "9021/images/tiles/crate.webp", destination: "graft/moulinette/9021/images/tiles/crate.webp" },
      { source: "13648/images/maps/junkyard.webp", destination: "graft/moulinette/13648/images/maps/junkyard.webp" },
      { source: "13648/json/scene/junkyard.json", destination: "graft/moulinette/13648/json/scene/junkyard.json" },
    ] } });
    const scene = file.entries.find((e) => e.type === "Scene")!;
    assert.equal(scene.source, "graft/moulinette/13648/json/scene/junkyard.json");
    assert.deepEqual(scene.patch["background"], { src: "graft/moulinette/13648/images/maps/junkyard.webp" });
    assert.equal(scene.patch["navName"], `see ${MAP}`, "a reference inside longer text is not one");
    assert.doesNotMatch(JSON.stringify({ ...scene, patch: { ...scene.patch, navName: "" } }), /@moulinette/);
  });

  it("keeps the pack as written, so the source and the destination agree", () => {
    const { file } = buildGrafts([junkyard({ source: "Scene", patch: { background: { src: "@moulinette/00123/a.webp" } } })], opts);
    assert.deepEqual(file.assets!.moulinette!.files, [{ source: "00123/a.webp", destination: "graft/moulinette/00123/a.webp" }]);
  });

  it("warns about one that is malformed, and leaves it as written", () => {
    const { file, warnings } = buildGrafts([junkyard({ source: "Scene", patch: { background: { src: "@moulinette/abc/a.webp" } } })], opts);
    assert.match(warnings[0]!, /"@moulinette\/abc\/a\.webp" is not a Moulinette reference/);
    assert.equal("assets" in file, false);
  });

  it("treats a path that climbs out of its folder, or is empty, as malformed", () => {
    for (const src of ["@moulinette/1/../../worlds/w/a.webp", "@moulinette/1/"]) {
      const { file, warnings } = buildGrafts([junkyard({ source: "Scene", patch: { background: { src } } })], opts);
      assert.equal("assets" in file, false, src);
      assert.match(warnings[0]!, /is not a Moulinette reference/, src);
    }
  });

  it("keeps a page's files out of the grafts of a role that cannot see the page", () => {
    const metas = [{ path: "Scenes/Junkyard.md", title: "Junkyard", role: "dm", frontmatter: { foundry: { source: SCENE, type: "Scene" } } }];
    const visible = (roles: string[]) => buildGrafts(pagesFrom(metas, new Set(roles)), opts).file;
    assert.equal("assets" in visible(["public", "player"]), false);
    assert.equal(visible(["public", "player", "dm"]).assets!.moulinette!.files.length, 1);
  });

  it("adds no assets block to a vault that names none", () => {
    assert.equal("assets" in buildGrafts([page("Characters/Marlo.md")], opts).file, false);
  });
});
