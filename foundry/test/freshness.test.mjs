// Deciding which prompt a vault module needs on world load, if any.
//
// Three failure modes, all seen: nagging when nothing changed, nagging after a
// decline, and the quiet one — a gated vault that can never report a hash and
// so was never offered its first build at all.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { __test, recordBuilt } from "../scripts/freshness.mjs";
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

describe("recordBuilt", () => {
  const savedFetch = globalThis.fetch;
  const savedGame = globalThis.game;
  afterEach(() => { globalThis.fetch = savedFetch; globalThis.game = savedGame; });

  /** A world where graft answers with one marker and the GM holds a token. */
  function installWorld({ readGrafts, stored = {} }) {
    const settings = { "vaults.tokens": { "https://v.example.com": "tok" }, "vaults.builtHashes": stored };
    globalThis.game = {
      modules: { get: (id) => id === "graft" ? { api: { readGrafts } } : null },
      settings: {
        get: (m, k) => settings[`${m}.${k}`],
        set: async (m, k, v) => { settings[`${m}.${k}`] = v; },
      },
    };
    return settings;
  }

  test("notes the hash of what was just built", async () => {
    // Fired from graft's hook, so a build started from its own controls
    // records too; before this only a prompted build ever did.
    const settings = installWorld({ readGrafts: async () => [{ vault: "https://v.example.com", gated: true }] });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: "after01" }) });
    await recordBuilt("southaven");
    assert.deepEqual(settings["vaults.builtHashes"], { southaven: "after01" });
  });

  test("leaves other modules' records alone", async () => {
    const settings = installWorld({
      readGrafts: async () => [{ vault: "https://v.example.com", gated: true }],
      stored: { other: "keep0" },
    });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: "after01" }) });
    await recordBuilt("southaven");
    assert.deepEqual(settings["vaults.builtHashes"], { other: "keep0", southaven: "after01" });
  });

  test("ignores a graft module that is not a vault", async () => {
    const settings = installWorld({ readGrafts: async () => [{ id: "abcdefghijklmnop", pack: "p", patch: {} }] });
    globalThis.fetch = async () => { throw new Error("should not be fetched"); };
    await recordBuilt("some-other-module");
    assert.deepEqual(settings["vaults.builtHashes"], {});
  });
});
