// The version a vault's Foundry module carries.
//
// It was the deploy's asset hash — a stylesheet fingerprint, unreadable in
// Foundry's module list and impossible to order. Foundry decides whether an
// update exists with `isNewerVersion`, so a hash means it can never say yes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { moduleVersion, ordersAbove } from "../src/foundry-version.js";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
/** The files a module ships, defaulting to a manifest that never changes. */
const files = (over: Record<string, unknown> = {}) =>
  [{ name: "module.json", data: Buffer.from(JSON.stringify({ id: "my-vault", title: "My Vault", packs: [{ name: "a" }], ...over })) }];

describe("moduleVersion", () => {
  it("reads as the day the module changed", () => {
    assert.equal(moduleVersion(files(), undefined, day(2026, 8, 29)).version, "2026.8.29");
  });

  it("does not move when the module has not changed", () => {
    // A module that offers an update containing nothing is one people learn to
    // dismiss, and the vault is rebuilt on every push.
    const first = moduleVersion(files(), undefined, day(2026, 8, 29));
    const later = moduleVersion(files(), first, day(2026, 9, 14));
    assert.deepEqual(later, first);
  });

  it("moves when the module does", () => {
    const first = moduleVersion(files(), undefined, day(2026, 8, 29));
    const next = moduleVersion(files({ packs: [{ name: "a" }, { name: "b" }] }), first, day(2026, 9, 14));
    assert.equal(next.version, "2026.9.14");
    assert.notEqual(next.hash, first.hash);
  });

  it("counts within a day rather than repeating a version", () => {
    let v = moduleVersion(files(), undefined, day(2026, 8, 29));
    v = moduleVersion(files({ title: "Renamed" }), v, day(2026, 8, 29));
    assert.equal(v.version, "2026.8.29.1");
    v = moduleVersion(files({ title: "Again" }), v, day(2026, 8, 29));
    assert.equal(v.version, "2026.8.29.2");
  });

  it("orders the way Foundry compares versions", () => {
    // Each issued version numeric and increasing per segment, so
    // isNewerVersion agrees with the order they were issued in.
    let v = moduleVersion(files(), undefined, day(2026, 8, 29));
    const issued = [v.version];
    for (const [m, when] of [
      [files({ title: "B" }), day(2026, 8, 29)],
      [files({ title: "C" }), day(2026, 9, 14)],
      [files({ title: "D" }), day(2027, 1, 2)],
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
    const v = moduleVersion(files(), before, day(2026, 8, 2));
    assert.equal(v.version, "2026.8.2");
  });

  it("moves when a file beside the manifest changes", () => {
    // The bug this exists for: graft's entry-file format went to 2, the
    // manifest was untouched, so no update was offered.
    const beside = (data: string) => [...files(), { name: "grafts.json", data: Buffer.from(data) }];
    const first = moduleVersion(beside('[{"vault":"https://v.example"}]'), undefined, day(2026, 8, 29));
    const next = moduleVersion(beside('{"format":2,"entries":[]}'), first, day(2026, 9, 14));
    assert.equal(next.version, "2026.9.14");
    assert.notEqual(next.hash, first.hash);
  });
});

describe("ordersAbove", () => {
  it("agrees with the order moduleVersion issues", () => {
    assert.equal(ordersAbove("2026.9.6", "2026.8.30"), true);
    assert.equal(ordersAbove("2026.8.30.1", "2026.8.30"), true);
    assert.equal(ordersAbove("2026.8.30", "2026.8.30"), false);
  });

  it("refuses a version that would strand every installed copy", () => {
    // An author switching to their own numbering after dates have shipped:
    // Foundry compares 1 against 2026 and never offers the update again.
    assert.equal(ordersAbove("1.4.0", "2026.9.6"), false);
  });

  it("compares segments as numbers, not as text", () => {
    // "10" sorts before "9" as a string, and a vault gets stuck every October.
    assert.equal(ordersAbove("2026.10.1", "2026.9.6"), true);
  });
});
