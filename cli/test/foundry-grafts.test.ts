// Compiling a vault into a grafts.json.
//
// The decision this file exists to protect is which rendered variant a page's
// body comes from. A player-observable document must carry the body a player
// would have been served; taking the GM's variant instead publishes `[!dm]`
// blocks to the table, and it would do it silently.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildGrafts, contentHash, journalEntries, documentEntries, documentTypeOf, observable, basesOf, moduleGrafts, moduleManifest, subtypeOf,
  entryId, pageId, instanceId, itemId, withItemIds, folderOf, pagesFrom, linkIndex, withFolderIndexes, type Page, type GraftOptions,
} from "../src/foundry-grafts.js";
import { DOC_TYPES } from "../src/foundry-types.js";

const opts: GraftOptions = {
  vaultId: "marlo",
  roles: ["public", "player", "dm"],
  playerRole: "player",
  buildRole: "dm",
  packs: { JournalEntry: "marlo-journals", Actor: "marlo-actors", Item: "marlo-items" },
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
    assert.equal(entries[0]!.pack, "marlo-journals");
  });

  it("never carries a body, only a reference to one", () => {
    // Inlining would make this file megabytes and re-download every page on
    // every build. The provider batches these through /_batch instead.
    const [entry] = journalEntries([page("Characters/Marlo.md")], opts);
    const pages = entry!.patch["pages"] as Array<Record<string, any>>;
    assert.equal(pages[0]!.text.content, "@vaults/dm/Characters/Marlo.foundry.html");
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

describe("documents from foundry.source", () => {
  it("become a graft of what they are based on", () => {
    // This is the whole of what instance.mjs did at runtime.
    const { entries } = documentEntries([
      page("Characters/Marlo.md", {
        role: "dm",
        foundry: { source: "Compendium.some-bestiary.actors.Actor.mmBandit000000",
                   patch: { system: { attributes: { hp: { value: 45 } } } } },
      }),
    ], opts);

    assert.equal(entries[0]!.source, "Compendium.some-bestiary.actors.Actor.mmBandit000000");
    assert.equal(entries[0]!.type, "Actor");
    assert.equal(entries[0]!.pack, "marlo-actors");
    // The page's own value stands, with the dnd5e default for a description
    // filled in beside it rather than over it.
    const system = entries[0]!.patch["system"] as any;
    assert.deepEqual(system.attributes, { hp: { value: 45 } });
    assert.equal(system.details.biography.value, "@vaults/dm/Characters/Marlo.foundry.html");
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
      page("x.md", { foundry: { source: "Compendium.a.b.Scene.cccccccccccccccc" } }),
      page("y.md", { foundry: { source: "nonsense" } }),
    ], opts);
    assert.deepEqual(entries, []);
    assert.match(warnings[0]!, /no pack declared for Scene/);
    assert.match(warnings[1]!, /cannot tell what kind/);
  });
});

describe("grafting onto a sibling entry", () => {
  const sibling = (id: string) => `Compendium.marlo.marlo-actors.Actor.${id}`;

  it("is quiet when the sibling is in this build", () => {
    const { entries, warnings } = documentEntries([
      page("Bestiary/Wight.md", {
        foundry: { source: "Compendium.some-bestiary.actors.Actor.mmWight00000000",
                   patch: { _id: "344a28ac1128a1d5" } },
      }),
      page("NPCs/Brynn.md", { foundry: { source: sibling("344a28ac1128a1d5") } }),
    ], opts);
    assert.equal(entries.length, 2);
    assert.deepEqual(warnings, []);
  });

  it("names the page whose sibling this variant filtered out", () => {
    // Role gating decides membership per variant, so a public page grafting
    // onto a dm-only one builds for the GM and skips for everyone else.
    const { warnings } = documentEntries([
      page("NPCs/Brynn.md", { foundry: { source: sibling("344a28ac1128a1d5") } }),
    ], opts);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /NPCs\/Brynn\.md/);
    assert.match(warnings[0]!, /which this build does not make/);
  });

  it("is quiet when a fallback outside the vault survives the gating", () => {
    // The fix for the case above: the GM resolves the sibling, and everyone
    // else falls through to the statblock they think the NPC is.
    const { warnings } = documentEntries([
      page("NPCs/Brynn.md", { foundry: { source: [sibling("344a28ac1128a1d5"), "Compendium.some-bestiary.actors.Actor.mmCommoner0000000"] } }),
    ], opts);
    assert.deepEqual(warnings, []);
  });

  it("warns when no source in the list survives, and names them all", () => {
    const { warnings } = documentEntries([
      page("NPCs/Brynn.md", { foundry: { source: [sibling("344a28ac1128a1d5"), sibling("gone000000000000")] } }),
    ], opts);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /344a28ac1128a1d5/);
    assert.match(warnings[0]!, /gone000000000000/);
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
  it("declares its format, which lets a newer vault refuse an older graft", () => {
    const { file } = buildGrafts([page("A/B.md")], opts);
    assert.equal(file.format, 1);
    assert.equal(file.entries.length, 1);
  });
});

describe("the module a vault ships", () => {
  it("declares every pack type, used or not", async () => {
    // Packs are read when the server starts, so a vault that later gains its
    // first Scene would otherwise need reinstalling and a restart.
    const m = moduleManifest({ moduleId: "marlo", title: "Marlo", vaultUrl: "https://marlo.example.com/" });
    const packs = m["packs"] as Array<Record<string, any>>;
    // Every type a compendium can hold. Adventure is not one of them: it is
    // the other way of delivering the same vault, not a pack alongside these.
    assert.deepEqual(packs.map((p) => p.type).sort(),
      Object.keys(DOC_TYPES).filter((t) => t !== "Adventure").sort());
    assert.ok(packs.every((p) => p.ownership.PLAYER === "NONE"), "never player-browsable");
    assert.ok(packs.filter((p) => p.type === "Actor" || p.type === "Item").every((p) => p.system));
  });

  it("requires graft and the provider, so a missing one is Foundry's error", async () => {
    const m = moduleManifest({ moduleId: "marlo", title: "Marlo", vaultUrl: "https://marlo.example.com" });
    const ids = ((m["relationships"] as any).requires as Array<any>).map((r) => r.id);
    // The provider module's id is "vaults". Naming it anything else gives a
    // dependency Foundry cannot resolve, and the module installs but never
    // builds — the failure looks like empty packs, not a missing dependency.
    assert.deepEqual(ids, ["graft", "vaults"]);
    assert.equal(m["manifest"], "https://marlo.example.com/_foundry/module.json");
  });

  it("tells graft where its entries are", async () => {
    // graft reads `flags.graft.entries` to find anything at all. Without it the
    // module is a manifest and a set of empty packs.
    const m = moduleManifest({ moduleId: "marlo", title: "Marlo", vaultUrl: "https://x.example.com" });
    assert.deepEqual((m["flags"] as any).graft.entries, ["grafts.json"]);
  });

  it("ships a pointer, not a list", async () => {
    assert.deepEqual(
      moduleGrafts("https://marlo.example.com/", true),
      [{ vault: "https://marlo.example.com", gated: true }]);
  });

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

describe("a base priority list", () => {
  it("travels whole, so the fallback survives", async () => {
    // graft tries each in order, so a page can prefer better content without
    // demanding the reader own it.
    const { entries, warnings } = documentEntries([{
      path: "x.md", title: "X", role: "dm",
      foundry: { source: ["Compendium.a.b.Actor.aaaaaaaaaaaaaaaa", "Compendium.c.d.Actor.bbbbbbbbbbbbbbbb"] },
    }], opts);

    assert.deepEqual(entries[0]!.source,
      ["Compendium.a.b.Actor.aaaaaaaaaaaaaaaa", "Compendium.c.d.Actor.bbbbbbbbbbbbbbbb"]);
    assert.deepEqual(warnings, []);
    assert.deepEqual(basesOf(["", "Compendium.a.b.Actor.cccccccccccccccc"]),
      ["Compendium.a.b.Actor.cccccccccccccccc"]);
  });

  it("a single base stays a plain string", async () => {
    const { entries } = documentEntries([{
      path: "x.md", title: "X", role: "dm",
      foundry: { source: ["Compendium.a.b.Actor.aaaaaaaaaaaaaaaa"] },
    }], opts);
    assert.equal(typeof entries[0]!.source, "string");
  });

  it("refuses anything that is not a UUID or a list of them", async () => {
    assert.deepEqual(basesOf(42), []);
    assert.deepEqual(basesOf([]), []);
    assert.deepEqual(basesOf({ uuid: "x" }), []);
    const { warnings } = documentEntries([{ path: "y.md", title: "Y", role: "dm", foundry: { source: 42 } }], opts);
    assert.match(warnings[0]!, /should be a UUID or a list/);
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

describe("each role's file is buildable by that role", () => {
  it("never references a variant above the reader who receives it", async () => {
    // The file is served through the same gate as everything else, so a body
    // it names above the reader's role is one they cannot fetch.
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

describe("asset references are variant-scoped", () => {
  // Every reference in a variant's grafts.json names that variant's own
  // deploy: it is the only one the reader's token is guaranteed to fetch.
  // What keeps a DM asset from a player is not the variant an entry names but
  // that the player's own grafts.json (buildRole = their role) never lists
  // the DM page at all.
  const withToken = (role: string): Page => ({
    path: `Bestiary/${role}.md`, title: role, role,
    foundry: { source: "Actor:npc", patch: { prototypeToken: { texture: { src: "@vault/t/x.webp" } } } },
  });

  const srcOf = (p: Page, buildRole: string) => {
    const [entry] = documentEntries([p], { ...opts, playerRole: "player", buildRole }).entries;
    const token = entry!.patch["prototypeToken"] as Record<string, any>;
    return token["texture"]["src"] as string;
  };

  it("names the build role's own deploy, whatever the page's visibility", () => {
    assert.equal(srcOf(withToken("player"), "dm"), "@vaults/dm/t/x.webp");
    assert.equal(srcOf(withToken("dm"), "dm"), "@vaults/dm/t/x.webp");
  });

  it("a player's own file reaches only the player deploy", () => {
    assert.equal(srcOf(withToken("player"), "player"), "@vaults/player/t/x.webp");
  });

  it("matches the variant its own body is read from", () => {
    const page = withToken("player");
    const [journal] = journalEntries([page], { ...opts, playerRole: "player", buildRole: "dm" });
    const body = (journal!.patch["pages"] as Array<Record<string, any>>)[0]!.text.content as string;
    const variant = (s: string) => s.split("/")[1];
    assert.equal(variant(srcOf(page, "dm")), variant(body));
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

  it("stamps the documents inside an Adventure, not only the Adventure", () => {
    // The Adventure wrapper validating is not the Scene inside it validating.
    // Stamped after folding, every nested document arrives without one and the
    // Scene is the one that loses its levels for it.
    const { file } = buildGrafts([doc(), page("Notes/A.md")], { ...opts2, packaging: "adventure" });
    const patch = file.entries[0]!.patch as any;
    assert.equal(patch._stats.coreVersion, "14");
    assert.equal(patch.actors[0]._stats.coreVersion, "14");
    assert.equal(patch.journal[0]._stats.coreVersion, "14");
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
  const scenePacks = { ...opts.packs, Scene: "marlo-scenes" };
  const sceneOpts = { ...opts, packs: scenePacks };
  const doc = (foundry: Page["foundry"], path = "DM Notes/Scenes/Home.md"): Page =>
    ({ path, title: "Home", role: "dm", foundry });

  it("sync: false keeps the page out of Foundry entirely", () => {
    const p = doc({ source: "Scene", sync: false });
    assert.deepEqual(documentEntries([p], sceneOpts).entries, []);
    assert.equal(journalEntries([p], sceneOpts).length, 0);
    assert.equal(linkIndex([p], sceneOpts).targets.has(p.path), false);
  });

  it("journal: false makes the document but no journal page", () => {
    const p = doc({ source: "Scene", journal: false });
    assert.equal(documentEntries([p], sceneOpts).entries.length, 1);
    assert.equal(journalEntries([p], sceneOpts).length, 0);
  });

  it("journal: false points links at the document instead", () => {
    // The journal page a link would name does not exist, and the page still
    // has something a reader can be sent to.
    const p = doc({ source: "Scene", journal: false, patch: { _id: "marloHomeScene00" } });
    const target = linkIndex([p], sceneOpts).targets.get(p.path)!;
    assert.deepEqual(target, { doc: { type: "Scene", pack: "marlo-scenes", id: "marloHomeScene00" } });
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
    assert.equal(documentEntries([p], sceneOpts).entries[0]!.folder, "Shopping Districts");
  });
});

describe("map-note references", () => {
  const scenePacks = { ...opts.packs, Scene: "marlo-scenes" };
  const sceneOpts = { ...opts, packs: scenePacks };

  it("fills a note's journal ids from the page path it names", () => {
    const p: Page = {
      path: "DM Notes/Scenes/Home.md", title: "Home", role: "dm",
      foundry: { source: "Scene" },
      sidecar: { notes: [{ entryId: "@vault/Places/Arlanton", pageId: "staleOldId000000", x: 1 }] },
    };
    const [entry] = documentEntries([p], sceneOpts).entries;
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
    const [entry] = documentEntries([p], sceneOpts).entries;
    const [note] = (entry!.patch["notes"] as Array<Record<string, unknown>>);
    assert.equal(note!["pageId"], pageId("marlo", "Places/Arlanton.md"));
  });

  it("warns when a note names a page that is not in the build", () => {
    const p: Page = {
      path: "S.md", title: "S", role: "dm",
      foundry: { source: "Scene", patch: { notes: [{ entryId: "@vault/Nowhere/Gone" }] } },
    };
    const { warnings } = documentEntries([p], sceneOpts);
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
    const { entries } = documentEntries([macy, scene], sceneOpts);
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
    documentEntries([scene], { ...sceneOpts, buildRole: "public" });          // the player's build, no Macy
    const dm = documentEntries([macy, scene], { ...sceneOpts, buildRole: "dm" });
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
    const { warnings } = documentEntries([prose, macro, scene], { ...sceneOpts, packs: { ...scenePacks, Macro: "marlo-macros" } });
    assert.ok(warnings.some((w) => w.includes("Notes/Lore.md") && w.includes("no document")), warnings.join("; "));
    assert.ok(warnings.some((w) => w.includes("Macros/M.md") && w.includes("no journal page")), warnings.join("; "));
  });

  it("leaves a note that already carries plain ids alone", () => {
    const p: Page = {
      path: "S.md", title: "S", role: "dm",
      foundry: { source: "Scene", patch: { notes: [{ entryId: "abcdabcdabcdabcd", pageId: "x" }] } },
    };
    const [entry] = documentEntries([p], sceneOpts).entries;
    const [note] = (entry!.patch["notes"] as Array<Record<string, unknown>>);
    assert.equal(note!["entryId"], "abcdabcdabcdabcd");
  });
});

describe("contentHash", () => {
  const entries = () => buildGrafts([{
    path: "Bestiary/Wolf.md", title: "Wolf", role: "dm",
    foundry: { source: "Actor:npc", patch: {} },
  }], { ...opts, coreVersion: "14" }).file.entries;
  const bodies = new Map([["Bestiary/Wolf.md", "aaaa"], ["Notes/A.md", "bbbb"]]);

  it("is stable across identical inputs, whatever order the bodies arrive in", () => {
    const reversed = new Map([...bodies].reverse());
    assert.equal(contentHash(entries(), { "dm/a.webp": "1111" }, bodies),
      contentHash(entries(), { "dm/a.webp": "1111" }, reversed));
  });

  it("moves when an entry changes", () => {
    const changed = entries().map((e) => ({ ...e, patch: { ...e.patch, name: "Dire Wolf" } }));
    assert.notEqual(contentHash(entries(), {}, bodies), contentHash(changed, {}, bodies));
  });

  it("moves when only an asset's bytes change", () => {
    // A regenerated portrait keeps its name; the hash map is the one thing
    // about the build that notices.
    assert.notEqual(contentHash(entries(), { "dm/a.webp": "aaaa" }, bodies),
      contentHash(entries(), { "dm/a.webp": "bbbb" }, bodies));
  });

  it("moves when a page body changes and nothing else does", () => {
    // Bodies are references from the entries' point of view. Left out, a
    // prose edit — the common case — would never prompt a rebuild.
    const edited = new Map(bodies).set("Notes/A.md", "cccc");
    assert.notEqual(contentHash(entries(), {}, bodies), contentHash(entries(), {}, edited));
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
    assert.equal(artOf(withImage())["img"], "@vaults/dm/attachments/npcs/Marlo%20Vex.webp");
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
    // The entry's id is the one that counts. A patch that keeps its own can
    // disagree with it — harmless for a pack document, which graft stamps, but
    // an Adventure spreads the patch over the id it just assigned, so a
    // rejected `_id` would arrive and Foundry would refuse the document.
    const p = withImage({ foundry: { source: "Actor:npc", patch: { _id: "short" } } });
    assert.equal(artOf(p)["_id"], undefined);
    assert.match(documentEntries([p], opts).entries[0]!.id, /^[a-f0-9]{16}$/);
  });

  it("defaults an Actor's token from the same image", () => {
    const token = artOf(withImage())["prototypeToken"] as any;
    assert.equal(token.texture.src, "@vaults/dm/attachments/npcs/Marlo%20Vex.webp");
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
  const entryFor = (p: Page) => documentEntries([p], { ...opts, packs: { ...opts.packs, Scene: "marlo-scenes" } });

  it("pins a document id from patch._id", () => {
    const { entries } = entryFor(doc({ _id: "marloHomeScene00" }));
    assert.equal(entries[0]!.id, "marloHomeScene00");
  });

  it("keeps a sidecar's own _id out of the patch", () => {
    // Every Scene exported from Foundry carries the id it had in that world.
    // Left in, an Adventure spreads it over the id the entry just assigned and
    // the document arrives under an id nothing else in the build refers to.
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

describe("what packs a module declares", () => {

  it("declares exactly one for an Adventure", async () => {
    // Everything the vault holds goes inside it, so a new document type adds
    // nothing to declare, and empty packs beside it are just noise.
    const m = moduleManifest({
      moduleId: "v", title: "V", vaultUrl: "https://x", packaging: "adventure",
    });
    assert.deepEqual((m["packs"] as Array<any>).map((p) => [p.name, p.type]),
      [["v-adventure", "Adventure"]]);
  });

  it("gives the Adventure pack the vault's system", async () => {
    // Adventure.fromSource empties actors, items and their folders out of any
    // adventure read from a pack with no system. The data survives on disk
    // and every read of it arrives incomplete, with nothing saying so.
    const m = moduleManifest({
      moduleId: "v", title: "V", vaultUrl: "https://x",
      packaging: "adventure", systemId: "dnd5e",
    });
    assert.equal((m["packs"] as Array<any>)[0].system, "dnd5e");
  });

  it("files only the packs it declared", async () => {
    const m = moduleManifest({
      moduleId: "v", title: "V", vaultUrl: "https://x", packaging: "adventure",
    });
    assert.deepEqual((m["packFolders"] as Array<any>)[0].packs, ["v-adventure"]);
  });

  it("keeps the Adventure pack out of a compendium module", async () => {
    const m = moduleManifest({ moduleId: "v", title: "V", vaultUrl: "https://x" });
    assert.ok(!(m["packs"] as Array<any>).some((p) => p.type === "Adventure"));
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

  it("gives a uuid reference the id graft needs to key the array", () => {
    // Without one, isKeyedArray is false and the whole items array replaces
    // the source's items instead of merging into them.
    const out = stamp({ items: [{ uuid: "Compendium.kctg.p.Item.abc", system: { quantity: 40 } }] });
    const items = out["items"] as Record<string, unknown>[];
    assert.equal(items[0]!["_id"], itemId("southaven", "NPCs/Baldrin.md", "Compendium.kctg.p.Item.abc:0"));
    assert.deepEqual(items[0]!["system"], { quantity: 40 });
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
