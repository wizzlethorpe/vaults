// @moulinette/... reference parsing and resolution.
//
// The resolver itself needs Moulinette's module object, so the tests stub the
// two things it touches: api.searchAssets and a collection's downloadAsset.
// That is enough to cover the parts that decide behaviour — which assets are
// considered a match, and what happens to a reference that resolves to
// nothing — without a live entitled Foundry.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMoulinetteRef, resolveMoulinetteRefs } from "../scripts/moulinette.mjs";

test("parses a well-formed reference", () => {
  assert.deepEqual(parseMoulinetteRef("@moulinette/audio/Michael Ghelfi/Ambiences/Tavern (Loop).ogg"), {
    type: 7, typeName: "audio", creator: "Michael Ghelfi", pack: "Ambiences", file: "Tavern (Loop).ogg",
  });
  assert.equal(parseMoulinetteRef("@moulinette/map/MAD/Caverns/cavern_01.webp")?.type, 2);
  assert.equal(parseMoulinetteRef("@moulinette/image/X/Y/z.png")?.type, 3);
});

test("keeps slashes inside the file segment, since packs nest", () => {
  const ref = parseMoulinetteRef("@moulinette/audio/MG/Vol1/SFX/Basic/Water Fountain (Loop).ogg");
  assert.equal(ref?.file, "SFX/Basic/Water Fountain (Loop).ogg");
  assert.equal(ref?.pack, "Vol1");
});

test("rejects what it cannot act on", () => {
  assert.equal(parseMoulinetteRef("@vault/attachments/x.webp"), null, "a different prefix");
  assert.equal(parseMoulinetteRef("@moulinette/audio/OnlyTwo"), null, "too few segments");
  // Documents are deliberately unsupported: reaching them needs an integer
  // asset id, and a malformed one returns a *different* creator's asset.
  assert.equal(parseMoulinetteRef("@moulinette/actor/X/Y/z.json"), null, "unsupported type");
  assert.equal(parseMoulinetteRef(null), null);
});

/** Stub the module surface resolveOne reaches for. */
async function withMoulinette(assets, fn, { active = true, download = (a) => ({ path: "local/" + a.filepath }) } = {}) {
  const prev = globalThis.game;
  globalThis.game = {
    modules: {
      get: (id) => (id !== "moulinette" ? undefined : {
        active,
        api: { searchAssets: async () => ({ assets }) },
        collections: [{ getId: () => "mou-cloud-cached", downloadAsset: async (a) => download(a) }],
      }),
    },
  };
  // Must await: restoring synchronously pulls `game` out from under the
  // resolver's first suspension.
  try { return await fn(); } finally { globalThis.game = prev; }
}

const GHELFI = {
  creator: "Michael Ghelfi", pack: "Ambiences",
  filepath: "Tavern (Loop).ogg", collection: "mou-cloud-cached", _id: 42,
};
const REF = "@moulinette/audio/Michael Ghelfi/Ambiences/Tavern (Loop).ogg";

test("resolves a reference to a local path", async () => {
  await withMoulinette([GHELFI], async () => {
    const data = { sounds: [{ name: "Tavern", path: REF }] };
    const stats = await resolveMoulinetteRefs(data, () => {});
    assert.deepEqual(data, { sounds: [{ name: "Tavern", path: "local/Tavern (Loop).ogg" }] });
    assert.deepEqual(stats, { resolved: 1, unresolved: 0 });
  });
});

test("requires creator AND pack to match, not just the filename", async () => {
  // Search is fuzzy; the exact comparison is what makes two readers resolve
  // the same reference to the same asset.
  const impostor = { ...GHELFI, creator: "Someone Else" };
  await withMoulinette([impostor], async () => {
    const data = { sounds: [{ name: "Tavern", path: REF }] };
    await resolveMoulinetteRefs(data, () => {});
    assert.deepEqual(data.sounds, [], "a same-named asset from another creator must not match");
  });
});

test("an unresolved reference drops the entry that held it", async () => {
  // A Playlist sound with no path is worse than no sound.
  await withMoulinette([], async () => {
    const data = { name: "Ambience", sounds: [{ name: "Tavern", path: REF }, { name: "Local", path: "ok.ogg" }] };
    const stats = await resolveMoulinetteRefs(data, () => {});
    assert.deepEqual(data.sounds, [{ name: "Local", path: "ok.ogg" }]);
    assert.equal(data.name, "Ambience", "the rest of the document survives");
    assert.deepEqual(stats, { resolved: 0, unresolved: 1 });
  });
});

test("an unresolved nested key drops its container, not the document", async () => {
  await withMoulinette([], async () => {
    const data = { name: "Cavern", background: { src: "@moulinette/map/MAD/Caverns/c.webp" }, grid: { size: 140 } };
    await resolveMoulinetteRefs(data, () => {});
    assert.equal(data.background, undefined, "a background with no src is worse than none");
    assert.deepEqual(data.grid, { size: 140 }, "one unresolved map must not discard the scene");
    assert.equal(data.name, "Cavern");
  });
});

test("does nothing when Moulinette is absent or inactive", async () => {
  await withMoulinette([GHELFI], async () => {
    const data = { path: REF };
    const stats = await resolveMoulinetteRefs(data, () => {});
    assert.equal(data.path, undefined);
    assert.deepEqual(stats, { resolved: 0, unresolved: 1 });
  }, { active: false });
});

test("warns once per distinct problem, not once per reference", async () => {
  await withMoulinette([], async () => {
    const warnings = [];
    const data = { a: { p: REF }, b: { p: REF }, c: { p: REF } };
    await resolveMoulinetteRefs(data, (m) => warnings.push(m));
    assert.equal(warnings.length, 1, "an adventure repeats the same track across pages");
  });
});

test("survives a download that throws", async () => {
  await withMoulinette([GHELFI], async () => {
    const data = { path: REF };
    const stats = await resolveMoulinetteRefs(data, () => {});
    assert.equal(data.path, undefined);
    assert.equal(stats.unresolved, 1);
  }, { download: () => { throw new Error("network"); } });
});

test("leaves @vault/ and plain paths alone", async () => {
  await withMoulinette([GHELFI], async () => {
    const data = { a: "@vault/attachments/x.webp", b: "icons/svg/d20.svg", c: 42, d: null };
    const stats = await resolveMoulinetteRefs(data, () => {});
    assert.deepEqual(data, { a: "@vault/attachments/x.webp", b: "icons/svg/d20.svg", c: 42, d: null });
    assert.deepEqual(stats, { resolved: 0, unresolved: 0 });
  });
});
