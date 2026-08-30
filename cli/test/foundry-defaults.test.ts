// Default patches, and the order they stack in.
//
// The whole point of this being data is that the conditions disappear. "Only
// use the page's portrait if it named none of its own" is not written anywhere:
// it is what merging in this order means. So these tests are mostly about the
// order holding, and about a default that a page cannot satisfy leaving no
// trace rather than a hollow one.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { defaultsFor, resolvePageRefs, DEFAULT_PATCHES } from "../src/foundry-defaults.js";

describe("defaultsFor", () => {
  it("returns the type default, then the system's, least specific first", () => {
    const layers = defaultsFor("Actor", "dnd5e");
    assert.equal(layers.length, 2);
    assert.ok("img" in layers[0]!, "the type layer comes first");
    assert.ok("system" in layers[1]!, "the system layer comes second");
  });

  it("returns only the type default for a system with none", () => {
    assert.deepEqual(defaultsFor("Actor", "pf2e"), [DEFAULT_PATCHES["Actor"]]);
  });

  it("returns nothing for a type with no defaults at all", () => {
    assert.deepEqual(defaultsFor("Playlist", "dnd5e"), []);
  });

  it("gives a Scene no portrait, because a Scene has none", () => {
    assert.equal(DEFAULT_PATCHES["Scene"], undefined);
  });
});

describe("resolvePageRefs", () => {
  const page = { image: "/attachments/Marlo%20Vex.webp", body: "@vaults/dm/Actors/Marlo.foundry.html" };

  it("turns a page image into a vault reference", () => {
    assert.equal(resolvePageRefs("@page/image", page), "@vault/attachments/Marlo%20Vex.webp");
  });

  it("passes an external image through untouched", () => {
    assert.equal(resolvePageRefs("@page/image", { image: "https://x.example/a.webp" }),
      "https://x.example/a.webp");
  });

  it("uses the body reference as given, already variant-scoped", () => {
    assert.equal(resolvePageRefs("@page/body", page), page.body);
  });

  it("reaches into nested defaults", () => {
    const out = resolvePageRefs(DEFAULT_PATCHES["Actor"], page) as any;
    assert.equal(out.img, "@vault/attachments/Marlo%20Vex.webp");
    assert.equal(out.prototypeToken.texture.src, "@vault/attachments/Marlo%20Vex.webp");
  });

  it("drops a key the page cannot satisfy", () => {
    // Not an empty string and not a broken path: a page with no portrait has
    // no `img`, which is also how "only when the page has one" is expressed.
    assert.equal(resolvePageRefs({ img: "@page/image" }, {}), undefined);
  });

  it("drops an object emptied by that, rather than leaving a hollow one", () => {
    assert.equal(resolvePageRefs(DEFAULT_PATCHES["Actor"], {}), undefined);
    assert.deepEqual(
      resolvePageRefs({ img: "@page/image", name: "keep" }, {}),
      { name: "keep" });
  });

  it("leaves every other value exactly as it is", () => {
    const before = { a: 1, b: true, c: null, d: [1, 2], e: "plain", f: "@vault/x.webp" };
    assert.deepEqual(resolvePageRefs(before, page), before);
  });

  it("ignores a reference it does not know", () => {
    assert.equal(resolvePageRefs("@page/nonsense", page), undefined);
  });
});
