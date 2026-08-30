// The module archive.
//
// Written by hand because the module is two small JSON files and the
// alternative was shelling out to the `zip` binary, which is missing on Windows
// and on many CI images. A zip that is subtly wrong installs as a corrupt
// module, so these tests check the bytes against a real unzip rather than
// against this file's own idea of the format.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { zip } from "../src/zip.js";

const run = promisify(execFile);

async function unzipped(entries: { name: string; data: Buffer }[]) {
  const dir = await mkdtemp(join(tmpdir(), "vault-zip-"));
  const archive = join(dir, "m.zip");
  await writeFile(archive, zip(entries));
  await run("unzip", ["-q", archive, "-d", dir]);
  return { dir, archive };
}

describe("zip", () => {
  it("round-trips content through a real unzip", async () => {
    const entries = [
      { name: "mod/module.json", data: Buffer.from('{"id":"mod"}') },
      { name: "mod/grafts.json", data: Buffer.from('[{"vault":"https://x"}]') },
    ];
    const { dir } = await unzipped(entries);
    for (const e of entries) {
      assert.equal(await readFile(join(dir, e.name), "utf8"), e.data.toString());
    }
  });

  it("passes an integrity check, so the CRCs are right", async () => {
    // A wrong CRC still extracts on some tools and fails on others, which is
    // the worst version of this bug: it works on the machine that built it.
    const { archive } = await unzipped([{ name: "a/b.json", data: Buffer.from("x".repeat(5000)) }]);
    const { stdout } = await run("unzip", ["-t", archive]);
    assert.match(stdout, /No errors detected/);
  });

  it("handles an empty file", async () => {
    const { dir } = await unzipped([{ name: "mod/empty.json", data: Buffer.alloc(0) }]);
    assert.equal((await readFile(join(dir, "mod/empty.json"))).length, 0);
  });

  it("declares its names as UTF-8", async () => {
    // Asserted on the bytes rather than by extracting: Info-ZIP's `unzip`
    // ignores this flag and decodes names as CP437 regardless, so a round trip
    // through it would fail on a correct archive. Readers that do honour it
    // (Foundry's included) need the bit set or an accented vault name extracts
    // mangled.
    const archive = zip([{ name: "Café.json", data: Buffer.from("{}") }]);
    assert.equal(archive.readUInt16LE(6) & 0x0800, 0x0800, "local header");
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.equal(archive.readUInt16LE(central + 8) & 0x0800, 0x0800, "central directory");
  });

  it("is byte-identical for identical content", async () => {
    // The archive's hash is what tells a reader the module changed. A clock in
    // the header would announce a new version on every rebuild.
    const entries = [{ name: "a.json", data: Buffer.from("{}") }];
    assert.deepEqual(zip(entries), zip(entries));
  });
});
