// Deciding which prompt a vault module needs on world load, if any.
//
// Three failure modes, all seen: nagging when nothing changed, nagging after a
// decline, and the quiet one — a gated vault that can never report a hash and
// so was never offered its first build at all.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../scripts/freshness.mjs";
const { shouldPrompt, promptKind, markersOf, fetchHash, fetchVaultHash } = __test;

describe("shouldPrompt", () => {
  test("prompts when the deploy moved past the last build", () => {
    assert.equal(shouldPrompt("new1", "old0"), true);
  });

  test("stays quiet when nothing changed, and after a decline of this same push", () => {
    // Declining records the hash, so the same value comes back as "same".
    assert.equal(shouldPrompt("same", "same"), false);
  });

  test("prompts when there is no record yet", () => {
    assert.equal(shouldPrompt("new1", undefined), true);
  });

  test("treats an unreadable deploy as not-new, not as changed", () => {
    assert.equal(shouldPrompt(null, "old0"), false);
  });
});

describe("promptKind", () => {
  test("offers setup before anything is built, with or without a hash", () => {
    // The gated case: no token yet, so no hash, and the old code read that as
    // "nothing changed" and said nothing at all.
    assert.equal(promptKind({ setup: true, fetched: null, recorded: undefined }), "Setup");
    assert.equal(promptKind({ setup: true, fetched: "abc", recorded: undefined }), "Setup");
  });

  test("offers an update once something is built and the deploy moved", () => {
    assert.equal(promptKind({ setup: false, fetched: "new1", recorded: "old0" }), "Fresh");
  });

  test("says nothing when a built vault is current, or cannot be read", () => {
    assert.equal(promptKind({ setup: false, fetched: "same", recorded: "same" }), null);
    assert.equal(promptKind({ setup: false, fetched: null, recorded: "old0" }), null);
  });
});

describe("markersOf", () => {
  test("keeps only vault markers", () => {
    const entries = [
      { vault: "https://v.example.com", gated: true },
      { id: "built0000", vault: "https://v.example.com" },   // built entry passing back through
      { vault: "" },
      { pack: "p", patch: {} },
    ];
    assert.deepEqual(markersOf(entries), [{ vault: "https://v.example.com", gated: true }]);
  });
});

describe("fetchHash", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });

  test("reads the content hash, through the token-carrying URL", async () => {
    let asked;
    globalThis.fetch = async (u) => {
      asked = String(u);
      return { ok: true, json: async () => ({ content: "abc123" }) };
    };
    const hash = await fetchHash({ url: "https://v.example.com", token: "tok" });
    assert.equal(hash, "abc123");
    assert.match(asked, /_foundry\/version\.json/);
    assert.match(asked, /_token=tok/);
  });

  test("returns null for a missing file, a bad body, or a network error", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    assert.equal(await fetchHash({ url: "https://v.example.com" }), null);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: "not-it" }) });
    assert.equal(await fetchHash({ url: "https://v.example.com" }), null);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await fetchHash({ url: "https://v.example.com" }), null);
  });
});

describe("fetchVaultHash", () => {
  const savedFetch = globalThis.fetch;
  const savedGame = globalThis.game;
  afterEach(() => { globalThis.fetch = savedFetch; globalThis.game = savedGame; });

  const withTokens = (tokens) => {
    globalThis.game = { settings: { get: () => tokens } };
  };

  test("does not reach for a gated vault the GM has not connected to", async () => {
    // Asserting the fetch never happens, not just that the answer is null:
    // fetchHash swallows errors, so a thrown "should not be fetched" comes
    // back as null and the test would pass without the short-circuit.
    withTokens({});
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: "leaked" }) });
    assert.equal(await fetchVaultHash([{ vault: "https://v.example.com", gated: true }]), null);
  });

  test("reads through once a token exists", async () => {
    withTokens({ "https://v.example.com": "tok" });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: "abc123" }) });
    assert.equal(await fetchVaultHash([{ vault: "https://v.example.com", gated: true }]), "abc123");
  });

  test("an ungated vault needs no token", async () => {
    withTokens({});
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: "open1" }) });
    assert.equal(await fetchVaultHash([{ vault: "https://v.example.com" }]), "open1");
  });
});
