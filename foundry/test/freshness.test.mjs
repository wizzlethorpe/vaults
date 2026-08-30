// Deciding when to say "your vault has new content".
//
// The wrong failure modes are both nags: prompting when nothing changed, and
// prompting on every load after a decline. The hash pair is what prevents
// both, so the decision function is pinned on its own.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../scripts/freshness.mjs";
const { shouldPrompt, markersOf, fetchHash } = __test;

describe("shouldPrompt", () => {
  test("prompts when the deploy moved past the last build", () => {
    assert.equal(shouldPrompt("new1", "old0", false), true);
  });

  test("stays quiet when nothing changed", () => {
    assert.equal(shouldPrompt("same", "same", false), false);
  });

  test("stays quiet after a decline of this same push", () => {
    // Declining records the hash, so the same value comes back as "same".
    assert.equal(shouldPrompt("new1", "new1", false), false);
  });

  test("prompts when there is no record yet", () => {
    // First load after the feature arrives: recorded is undefined, the deploy
    // is readable, and asking once is how the record gets seeded.
    assert.equal(shouldPrompt("new1", undefined, false), true);
  });

  test("defers to graft's own prompt for a module never built", () => {
    assert.equal(shouldPrompt("new1", undefined, true), false);
  });

  test("treats an unreadable deploy as not-new, not as changed", () => {
    assert.equal(shouldPrompt(null, "old0", false), false);
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
