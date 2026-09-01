// The transform's own decisions, without a world.
//
// What is testable here is the part that runs before anything is fetched:
// recognising the one line a vault's module ships, and naming the directory
// its files land in. The fetching itself needs Foundry.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../scripts/transform.mjs";

const { isMarker, vaultKey } = __test;

describe("isMarker", () => {
  test("recognises the pointer a vault's module ships", () => {
    assert.equal(isMarker({ vault: "https://marlo.example.com", gated: true }), true);
  });

  test("ignores anything without a vault URL", () => {
    for (const e of [{}, null, undefined, { vault: 42 }, { vault: "" }, { id: "abc", type: "Actor", pack: "p", patch: {} }]) {
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
