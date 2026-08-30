// The version a vault's Foundry module carries.
//
// It was the deploy's asset hash — a stylesheet fingerprint, unreadable in
// Foundry's module list and impossible to order. Foundry decides whether an
// update exists with `isNewerVersion`, so a hash means it can never say yes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { moduleVersion } from "../src/foundry-version.js";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const manifest = (over: Record<string, unknown> = {}) =>
  ({ id: "my-vault", title: "My Vault", packs: [{ name: "a" }], ...over });

describe("moduleVersion", () => {
  it("reads as the day the module changed", () => {
    assert.equal(moduleVersion(manifest(), undefined, day(2026, 8, 29)).version, "2026.8.29");
  });

  it("does not move when the module has not changed", () => {
    // A module that offers an update containing nothing is one people learn to
    // dismiss, and the vault is rebuilt on every push.
    const first = moduleVersion(manifest(), undefined, day(2026, 8, 29));
    const later = moduleVersion(manifest(), first, day(2026, 9, 14));
    assert.deepEqual(later, first);
  });

  it("moves when the module does", () => {
    const first = moduleVersion(manifest(), undefined, day(2026, 8, 29));
    const next = moduleVersion(manifest({ packs: [{ name: "a" }, { name: "b" }] }), first, day(2026, 9, 14));
    assert.equal(next.version, "2026.9.14");
    assert.notEqual(next.hash, first.hash);
  });

  it("counts within a day rather than repeating a version", () => {
    let v = moduleVersion(manifest(), undefined, day(2026, 8, 29));
    v = moduleVersion(manifest({ title: "Renamed" }), v, day(2026, 8, 29));
    assert.equal(v.version, "2026.8.29.1");
    v = moduleVersion(manifest({ title: "Again" }), v, day(2026, 8, 29));
    assert.equal(v.version, "2026.8.29.2");
  });

  it("orders the way Foundry compares versions", () => {
    // Each component numeric and non-decreasing, so isNewerVersion agrees with
    // the order they were issued in.
    const seq = ["2026.8.29", "2026.8.29.1", "2026.9.14", "2027.1.2"];
    const parts = (v: string) => v.split(".").map(Number);
    for (let i = 1; i < seq.length; i++) {
      const [a, b] = [parts(seq[i - 1]!), parts(seq[i]!)];
      const newer = a.some((n, j) => (b[j] ?? 0) > n) || b.length > a.length;
      assert.ok(newer, `${seq[i]} should be newer than ${seq[i - 1]}`);
    }
  });

  it("ignores the version already on the manifest when fingerprinting", () => {
    // Otherwise stamping a version changes the manifest, which changes the
    // fingerprint, which demands a new version, forever.
    const a = moduleVersion(manifest({ version: "old" }), undefined, day(2026, 8, 29));
    const b = moduleVersion(manifest({ version: a.version }), a, day(2026, 8, 30));
    assert.deepEqual(b, a);
  });
});
