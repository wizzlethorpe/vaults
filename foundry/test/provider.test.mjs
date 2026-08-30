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

  test("is stable across paths and ports on the same host", () => {
    assert.equal(vaultKey("https://a.example.com/x"), vaultKey("https://a.example.com/y"));
  });

  test("produces something usable from a URL it cannot parse", () => {
    assert.equal(vaultKey("not a url"), "vault");
  });
});
