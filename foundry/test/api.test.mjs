// The /_batch endpoint URL. It shipped broken once, silently — the whole
// story is on batchEndpoint's docblock; these tests pin the repair.

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

