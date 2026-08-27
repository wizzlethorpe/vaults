// The /_batch endpoint URL.
//
// This shipped broken, and the way it failed is the reason these tests exist:
// nothing raised an error. `url()` puts the bearer in the query string, and the
// role was appended with a second "?", so the role became part of the token's
// value. The token then failed to verify, the request fell back to the lowest
// role, and every page above that tier came back in `missing` — which the batch
// endpoint reports as a 200. The sync logged "no content" per page and carried
// on. A vault's entire DM tier stopped syncing without a single failed request.

import test from "node:test";
import assert from "node:assert/strict";

import { batchEndpoint } from "../scripts/api.mjs";

const VAULT = { url: "https://vault.example", token: "TOKEN123" };

test("the token and the role are separate parameters", () => {
  const u = batchEndpoint(VAULT, "DM");
  assert.equal(u.searchParams.get("_token"), "TOKEN123");
  assert.equal(u.searchParams.get("role"), "DM");
});

test("the token survives intact when a role is requested", () => {
  // The specific corruption: "?_token=TOKEN123?role=DM" parses as a single
  // parameter whose value carries the role, and the token no longer verifies.
  const u = batchEndpoint(VAULT, "DM");
  assert.ok(!u.searchParams.get("_token").includes("role"),
    `token was corrupted: ${u.searchParams.get("_token")}`);
  assert.equal((u.toString().match(/\?/g) || []).length, 1,
    `more than one "?" in ${u.toString()}`);
});

test("no role asked for means no role parameter", () => {
  // Absent, not empty: the middleware distinguishes them. `?role=` would parse
  // as the empty string, which is not a known role, and be refused with a 403.
  const u = batchEndpoint(VAULT, undefined);
  assert.equal(u.searchParams.get("role"), null);
  assert.equal(u.searchParams.get("_token"), "TOKEN123");
});

test("a role containing URL-significant characters is encoded", () => {
  const u = batchEndpoint(VAULT, "tier one&two");
  assert.equal(u.searchParams.get("role"), "tier one&two");
});

test("a public vault carries a role but no token", () => {
  const u = batchEndpoint({ url: "https://vault.example" }, "public");
  assert.equal(u.searchParams.get("_token"), null);
  assert.equal(u.searchParams.get("role"), "public");
});

// ── what the media cache should and should not pull ──────────────────────────

test("the module manifest is not cached as page media", async () => {
  // `vaults build --module` writes module.json beside the module zip. It is
  // there to be installed from, and Foundry refuses to overwrite a non-media
  // file, so every sync after the first failed its upload and reported an
  // image error. The zip is already excluded, by extension.
  const { isCacheable } = await import("../scripts/media.mjs");
  assert.equal(isCacheable("downloads/module.json"), false);
  assert.equal(isCacheable("module.json"), false);
  assert.equal(isCacheable("downloads/marlo-download-test.zip"), false);
});

test("real page media is still cached", async () => {
  const { isCacheable } = await import("../scripts/media.mjs");
  assert.equal(isCacheable("attachments/npcs/images/Macy Arla.webp"), true);
  assert.equal(isCacheable("attachments/foundry/gnome-bank.ogg"), true);
  // A JSON that is genuinely page data still is, so the rule stays narrow.
  assert.equal(isCacheable("attachments/scenes/junkyard.json"), true);
});

test("build-internal artifacts stay excluded", async () => {
  const { isCacheable } = await import("../scripts/media.mjs");
  assert.equal(isCacheable("_search-index.json"), false);
  assert.equal(isCacheable("Creatures/index.preview.json"), false);
});
