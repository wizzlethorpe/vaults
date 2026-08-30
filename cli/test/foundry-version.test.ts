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
    // Each issued version numeric and increasing per segment, so
    // isNewerVersion agrees with the order they were issued in.
    let v = moduleVersion(manifest(), undefined, day(2026, 8, 29));
    const issued = [v.version];
    for (const [m, when] of [
      [manifest({ title: "B" }), day(2026, 8, 29)],
      [manifest({ title: "C" }), day(2026, 9, 14)],
      [manifest({ title: "D" }), day(2027, 1, 2)],
    ] as const) {
      v = moduleVersion(m, v, when);
      issued.push(v.version);
    }
    const parts = (x: string) => x.split(".").map(Number);
    for (let i = 1; i < issued.length; i++) {
      const [a, b] = [parts(issued[i - 1]!), parts(issued[i]!)];
      const newer = a.some((n, j) => (b[j] ?? 0) > n) || b.length > a.length;
      assert.ok(newer, `${issued[i]} should be newer than ${issued[i - 1]}`);
    }
  });

  it("does not mistake a different day for the same one", () => {
    // "2026.8.29" starts with "2026.8.2": a prefix test would read the day
    // field as a same-day counter and issue 2026.8.2.10.
    const before = { version: "2026.8.29", hash: "aaaaaaaaaaaa" };
    const v = moduleVersion(manifest(), before, day(2026, 8, 2));
    assert.equal(v.version, "2026.8.2");
  });

  it("ignores the version already on the manifest when fingerprinting", () => {
    // Otherwise stamping a version changes the manifest, which changes the
    // fingerprint, which demands a new version, forever.
    const a = moduleVersion(manifest({ version: "old" }), undefined, day(2026, 8, 29));
    const b = moduleVersion(manifest({ version: a.version }), a, day(2026, 8, 30));
    assert.deepEqual(b, a);
  });
});
