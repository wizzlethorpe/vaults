// @moulinette/... reference parsing and resolution.
//
// The resolver reads Moulinette's cached asset index, so the tests stub the
// three things it touches: the module's `collections` entry, the `cache`
// the collection's `initialize()` fills, and `selectAsset`. That covers the
// parts that decide behaviour — which assets count as a match, and what
// happens to a reference that resolves to nothing — without a live entitled
// Foundry.
//
// The stub mirrors the real shapes deliberately: assets carry `pack_id` (the
// pack_ref) and `url` (the filepath), and `selectAsset` returns a path string
// rather than an object. An earlier version of this resolver searched instead
// of indexing, and stubs that guessed the shapes hid three bugs that a live
// world would have hit immediately.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMoulinetteRef, resolveMoulinetteDocument, resolveMoulinetteRefs } from "../scripts/moulinette.mjs";

test("parses a reference into pack_ref and filepath", () => {
  assert.deepEqual(parseMoulinetteRef("@moulinette/10698/scenes/abandoned-mine-entrance.webp"), {
    pack: "10698", file: "scenes/abandoned-mine-entrance.webp",
  });
});

test("keeps slashes inside the file segment, since packs nest folders", () => {
  const ref = parseMoulinetteRef("@moulinette/442/SFX/Basic/Water Fountain (Loop).ogg");
  assert.equal(ref?.pack, "442");
  assert.equal(ref?.file, "SFX/Basic/Water Fountain (Loop).ogg");
});

test("rejects what it cannot act on", () => {
  assert.equal(parseMoulinetteRef("@vault/attachments/x.webp"), null, "a different prefix");
  assert.equal(parseMoulinetteRef("@moulinette/10698"), null, "no file segment");
  assert.equal(parseMoulinetteRef("@moulinette/"), null, "nothing at all");
  assert.equal(parseMoulinetteRef(null), null);
});

/** Stub the module surface the resolver reaches for. */
async function withMoulinette(assets, fn, {
  active = true,
  select = async (a) => "local/" + a.url,
  download = async () => ({ status: "success", path: "local", message: "{}" }),
  apiGET = async () => ({ id: 1 }),
  collections,
} = {}) {
  const prev = globalThis.game;
  const cache = { allAssets: null };
  globalThis.game = {
    modules: {
      get: (id) => (id !== "moulinette" ? undefined : {
        active,
        cache,
        cloudclient: { apiGET },
        getSessionId: () => "session",
        collections: collections ?? [{
          getId: () => "mou-cloud-cached",
          initialize: async () => { cache.allAssets = assets; },
          selectAsset: select,
          downloadAsset: download,
        }],
      }),
    },
  };
  // Must await: restoring synchronously pulls `game` out from under the
  // resolver's first suspension.
  try { return await fn(); } finally { globalThis.game = prev; }
}

/** Shapes match the real index: pack_id is the pack_ref, url is the filepath. */
const GHELFI = { pack_id: 442, url: "Tavern (Loop).ogg", id: 42 };
const REF = "@moulinette/442/Tavern (Loop).ogg";

test("resolves a reference to a local path", async () => {
  await withMoulinette([GHELFI], async () => {
    const doc = { sounds: [{ name: "Ambience", path: REF }] };
    const stats = await resolveMoulinetteRefs(doc, () => {});
    assert.equal(doc.sounds[0].path, "local/Tavern (Loop).ogg");
    assert.deepEqual(stats, { resolved: 1, unresolved: 0 });
  });
});

test("matches on pack_ref and filepath, not on a name that merely looks close", async () => {
  // The filename never appears in the indexed display name — Moulinette
  // prettifies `cavern_01.webp` into "Cavern 01 (webp)" — which is exactly
  // why this matches on the filepath instead.
  const other = { pack_id: 442, url: "Tavern (Oneshot).ogg", id: 43 };
  const wrongPack = { pack_id: 999, url: "Tavern (Loop).ogg", id: 44 };
  await withMoulinette([other, wrongPack, GHELFI], async () => {
    const doc = { path: REF };
    await resolveMoulinetteRefs(doc, () => {});
    assert.equal(doc.path, "local/Tavern (Loop).ogg");
  });
});

test("a pack_ref that differs only by type still matches", async () => {
  // The index carries pack_id as a number, the reference is text.
  await withMoulinette([{ pack_id: "442", url: "Tavern (Loop).ogg", id: 42 }], async () => {
    const doc = { path: REF };
    await resolveMoulinetteRefs(doc, () => {});
    assert.equal(doc.path, "local/Tavern (Loop).ogg");
  });
});

test("an unresolved reference takes its container, one level up", async () => {
  await withMoulinette([], async () => {
    const doc = {
      name: "Tavern",
      background: { src: REF },
      sounds: [{ name: "Ambience", path: REF }, { name: "Kept", path: "local/x.ogg" }],
    };
    const stats = await resolveMoulinetteRefs(doc, () => {});
    assert.equal(doc.background, undefined, "a background with no src is dropped");
    assert.deepEqual(doc.sounds.map((s) => s.name), ["Kept"], "the pathless sound is dropped");
    assert.equal(doc.name, "Tavern", "but the document itself survives");
    assert.equal(stats.unresolved, 1);
  });
});

test("a Scene or Scene Packer asset resolves to no path and is treated as unresolved", async () => {
  // Those download as JSON and report an empty path. A data tree wants a file.
  await withMoulinette([GHELFI], async () => {
    const warnings = [];
    const doc = { path: REF };
    await resolveMoulinetteRefs(doc, (m) => warnings.push(m));
    assert.equal(doc.path, undefined);
    assert.match(warnings.join("\n"), /not a media asset/);
  }, { select: async () => "" });
});

test("an inactive module leaves the reference unresolved, and says why", async () => {
  await withMoulinette([GHELFI], async () => {
    const warnings = [];
    const doc = { path: REF };
    const stats = await resolveMoulinetteRefs(doc, (m) => warnings.push(m));
    assert.equal(doc.path, undefined);
    assert.equal(stats.unresolved, 1);
    assert.match(warnings.join("\n"), /installed but not enabled/);
  }, { active: false });
});

test("an uninstalled module says so once, not once per reference", async () => {
  // The ordinary case: a reader who simply does not have Moulinette. Silence
  // here is indistinguishable from a vault that forgot to ship its assets.
  const prev = globalThis.game;
  globalThis.game = { modules: { get: () => undefined } };
  try {
    const warnings = [];
    const doc = { a: REF, b: REF, nested: { c: REF } };
    const stats = await resolveMoulinetteRefs(doc, (m) => warnings.push(m));
    assert.equal(stats.unresolved, 1, "one distinct reference");
    assert.equal(warnings.length, 1, "one warning, not one per occurrence");
    assert.match(warnings[0], /not installed/);
    assert.equal(doc.a, undefined);
    assert.equal(doc.nested, undefined, "the container goes with it");
  } finally { globalThis.game = prev; }
});

test("an index that is not a list is skipped, not thrown on", async () => {
  // cache.allAssets carries no contract. `?? []` covers an absent index but
  // not a changed one, and a non-array reaching .find() would throw — the one
  // thing this module promises never to do to a sync.
  const prev = globalThis.game;
  globalThis.game = {
    modules: {
      get: () => ({
        active: true,
        cache: { allAssets: { 0: GHELFI, length: 1 } },   // array-like, not an array
        cloudclient: { apiGET: async () => ({ id: 1 }) },
        getSessionId: () => "session",
        collections: [{
          getId: () => "mou-cloud-cached",
          initialize: async () => {},
          selectAsset: async () => "local/x",
          downloadAsset: async () => ({ status: "success" }),
        }],
      }),
    },
  };
  try {
    const warnings = [];
    const doc = { path: REF };
    const stats = await resolveMoulinetteRefs(doc, (m) => warnings.push(m));
    assert.equal(doc.path, undefined);
    assert.equal(stats.unresolved, 1);
    assert.match(warnings.join("\n"), /not a list/);
  } finally { globalThis.game = prev; }
});

test("a module whose internals moved warns once and resolves nothing", async () => {
  await withMoulinette([GHELFI], async () => {
    const warnings = [];
    const doc = { a: REF, b: REF };
    await resolveMoulinetteRefs(doc, (m) => warnings.push(m));
    assert.equal(warnings.length, 1, "one warning, not one per reference");
    assert.match(warnings[0], /not where we expect/);
  }, { collections: [{ getId: () => "mou-local" }] });
});

test("a failed download is reported, not thrown", async () => {
  await withMoulinette([GHELFI], async () => {
    const warnings = [];
    const doc = { path: REF };
    await resolveMoulinetteRefs(doc, (m) => warnings.push(m));
    assert.equal(doc.path, undefined);
    assert.match(warnings.join("\n"), /download failed/);
  }, { select: async () => { throw new Error("offline"); } });
});

test("loads the index once and resolves each distinct reference once", async () => {
  let initialized = 0, selected = 0;
  const cache = { allAssets: null };
  const prev = globalThis.game;
  globalThis.game = {
    modules: {
      get: () => ({
        active: true,
        cache,
        collections: [{
          getId: () => "mou-cloud-cached",
          initialize: async () => { initialized++; cache.allAssets = [GHELFI]; },
          selectAsset: async (a) => { selected++; return "local/" + a.url; },
          downloadAsset: async () => ({ status: "success", path: "local" }),
        }],
      }),
    },
  };
  try {
    const doc = { a: REF, b: REF, nested: { c: REF } };
    const stats = await resolveMoulinetteRefs(doc, () => {});
    assert.equal(initialized, 1, "index loaded once");
    assert.equal(selected, 1, "one download for three identical references");
    // Counts distinct assets, not occurrences: the number that matters for a
    // sync summary is how much the reader actually got.
    assert.equal(stats.resolved, 1);
    assert.equal(doc.nested.c, "local/Tavern (Loop).ogg");
  } finally { globalThis.game = prev; }
});

test("a vault with no references never touches Moulinette", async () => {
  let touched = false;
  const prev = globalThis.game;
  globalThis.game = { modules: { get: () => { touched = true; return undefined; } } };
  try {
    const doc = { img: "@vault/attachments/map.webp", name: "Keep" };
    const stats = await resolveMoulinetteRefs(doc, () => {});
    assert.equal(touched, false, "the index is loaded lazily");
    assert.equal(doc.img, "@vault/attachments/map.webp", "@vault/ is left for its own rewriter");
    assert.deepEqual(stats, { resolved: 0, unresolved: 0 });
  } finally { globalThis.game = prev; }
});

test("warns once about a malformed reference repeated across a document", async () => {
  await withMoulinette([GHELFI], async () => {
    const warnings = [];
    const doc = { a: "@moulinette/10698", b: "@moulinette/10698" };
    await resolveMoulinetteRefs(doc, (m) => warnings.push(m));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /expected @moulinette/);
  });
});

// --- documents (foundry.base) -------------------------------------------
//
// A Moulinette Scene is a *template*, not a picture of one, so it resolves to
// document data rather than to a path. It cannot go through selectAsset: for a
// .json asset that returns the containing folder, and the document itself
// arrives as `message`.

const SCENE_REF = "11938/json/scene/05-boar-s-tears-day.json";
const SCENE_ASSET = { pack_id: 11938, url: "json/scene/05-boar-s-tears-day.json", id: 7 };

test("resolves a document reference to parsed data, not a path", async () => {
  await withMoulinette([SCENE_ASSET], async () => {
    const data = await resolveMoulinetteDocument(SCENE_REF, () => {});
    assert.equal(data.name, "05. Boar's Tears (Day)");
    assert.equal(data.walls.length, 153);
  }, {
    download: async () => ({
      status: "success",
      path: "local/folder",
      message: JSON.stringify({ name: "05. Boar's Tears (Day)", walls: new Array(153).fill({}) }),
    }),
  });
});

test("asks for the asset by the id found in the index, never a written one", async () => {
  // The hazard that kept documents out of scope was a hand-authored id: the
  // cloud API truncates one at the first non-digit and returns a different
  // creator's asset. Looking the id up removes it.
  let asked = null;
  await withMoulinette([SCENE_ASSET], async () => {
    await resolveMoulinetteDocument(SCENE_REF, () => {});
    assert.equal(asked, "/asset/7");
  }, { apiGET: async (path) => { asked = path; return { id: 7 }; } });
});

test("a media asset is not a document, and says so", async () => {
  await withMoulinette([GHELFI], async () => {
    const warnings = [];
    const data = await resolveMoulinetteDocument("442/Tavern (Loop).ogg", (m) => warnings.push(m));
    assert.equal(data, null);
    assert.match(warnings.join("\n"), /is not a document/);
  }, { download: async () => ({ status: "success", path: "local/x.ogg" }) });
});

test("an unsubscribed reader gets null, not a throw", async () => {
  await withMoulinette([], async () => {
    assert.equal(await resolveMoulinetteDocument(SCENE_REF, () => {}), null);
  });
});

test("unparseable document JSON is reported, not thrown", async () => {
  await withMoulinette([SCENE_ASSET], async () => {
    const warnings = [];
    assert.equal(await resolveMoulinetteDocument(SCENE_REF, (m) => warnings.push(m)), null);
    assert.match(warnings.join("\n"), /could not read/);
  }, { download: async () => ({ status: "success", message: "{not json" }) });
});
