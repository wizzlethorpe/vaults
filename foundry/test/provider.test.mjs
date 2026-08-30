// The provider's own decisions, without a world.
//
// What is testable here is the part that runs before anything is fetched:
// recognising the one line a vault's module ships, and naming the directory
// its files land in. The fetching itself needs Foundry.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../scripts/provider.mjs";

const { isMarker, vaultKey } = __test;

describe("isMarker", () => {
  test("recognises the pointer a vault's module ships", () => {
    assert.equal(isMarker({ vault: "https://marlo.example.com", gated: true }), true);
  });

  test("does not mistake a built entry for one", () => {
    // Entries come back through the provider on later runs; treating one as a
    // marker would refetch the whole vault every pass and never settle.
    assert.equal(isMarker({ id: "abc", type: "Actor", pack: "p", patch: {} }), false);
    assert.equal(isMarker({ id: "abc", vault: "https://x", patch: {} }), false);
  });

  test("ignores anything without a vault URL", () => {
    for (const e of [{}, null, undefined, { vault: 42 }, { vault: "" }]) {
      assert.equal(isMarker(e), false, JSON.stringify(e));
    }
  });
});

describe("vaultKey", () => {
  test("names a directory after the vault's host", () => {
    assert.equal(vaultKey("https://marlo-mystery.pages.dev"), "marlo-mystery-pages-dev");
  });

  test("gives two vaults on different hosts different directories", () => {
    assert.notEqual(vaultKey("https://a.example.com"), vaultKey("https://b.example.com"));
  });

  test("keeps two vaults on one host apart, and ignores the port", () => {
    // Both would otherwise share one cache and one placed.json, and a file at
    // the same variant/path in each would overwrite the other's while the
    // record said it was placed.
    assert.notEqual(vaultKey("https://a.example.com/x"), vaultKey("https://a.example.com/y"));
    assert.equal(vaultKey("https://a.example.com:8443/x"), vaultKey("https://a.example.com/x"));
  });

  test("produces something usable from a URL it cannot parse", () => {
    assert.equal(vaultKey("not a url"), "vault");
  });
});

describe("enqueueFor", () => {
  // graft runs providers from a queue, and Moulinette runs before this one,
  // when the entries are still the marker line. Without this, every
  // @moulinette/ ambience in a vault scene 404s at the table.
  test("sends Moulinette round again when the entries reference it", async () => {
    const { __test } = await import("../scripts/provider.mjs");
    const entries = [{ id: "s1", type: "Scene", pack: "p", patch: {
      sounds: [{ path: "@moulinette/2307/Ambiences/Basic/Forest/Calm Forest.ogg" }],
    } }];
    assert.deepEqual(__test.enqueueFor(entries), ["moulinette"]);
  });

  test("reaches references nested inside an Adventure", async () => {
    const { __test } = await import("../scripts/provider.mjs");
    const entries = [{ id: "a", type: "Adventure", pack: "p", patch: {
      scenes: [{ _id: "s1", sounds: [{ path: "@moulinette/2697/Ambiences/Basic/Water/Large River.ogg" }] }],
    } }];
    assert.deepEqual(__test.enqueueFor(entries), ["moulinette"]);
  });

  test("enqueues nothing for a vault that uses no Moulinette content", async () => {
    const { __test } = await import("../scripts/provider.mjs");
    assert.deepEqual(__test.enqueueFor([{ id: "s1", patch: { sounds: [{ path: "@vaults/DM/a.ogg" }] } }]), []);
  });
});
