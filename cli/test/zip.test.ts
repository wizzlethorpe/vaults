// The module archive.
//
// Written by hand because the module is two small JSON files and the
// alternative was shelling out to the `zip` binary, which is missing on
// Windows and on many CI images. That is also why these tests cannot lean on
// an `unzip` binary: it is missing on exactly the machines zip.ts exists for.
// Extraction here goes through node's zlib — an implementation zip.ts does
// not share — and the one test that wants a real unzip skips without it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { crc32, inflateRawSync } from "node:zlib";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { zip } from "../src/zip.js";

const run = promisify(execFile);
const haveUnzip = await run("unzip", ["-v"]).then(() => true, () => false);

/** Extract via zlib, verifying each entry's CRC against an independent one. */
function extract(archive: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (archive.readUInt32LE(i) === 0x04034b50) {
    const method = archive.readUInt16LE(i + 8);
    const crc = archive.readUInt32LE(i + 14);
    const compressed = archive.readUInt32LE(i + 18);
    const nameLen = archive.readUInt16LE(i + 26);
    const extraLen = archive.readUInt16LE(i + 28);
    const name = archive.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const body = archive.subarray(i + 30 + nameLen + extraLen, i + 30 + nameLen + extraLen + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data) >>> 0, crc, `CRC of ${name}`);
    out.set(name, data);
    i += 30 + nameLen + extraLen + compressed;
  }
  return out;
}

describe("zip", () => {
  it("round-trips content, with every CRC checked independently", () => {
    const entries = [
      { name: "mod/module.json", data: Buffer.from('{"id":"mod"}') },
      { name: "mod/grafts.json", data: Buffer.from('[{"vault":"https://x"}]') },
      { name: "mod/big.json", data: Buffer.from("x".repeat(5000)) },
    ];
    const files = extract(zip(entries));
    for (const e of entries) {
      assert.deepEqual(files.get(e.name), e.data);
    }
  });

  it("handles an empty file", () => {
    assert.equal(extract(zip([{ name: "mod/empty.json", data: Buffer.alloc(0) }])).get("mod/empty.json")!.length, 0);
  });

  it("passes a real unzip's integrity check", { skip: !haveUnzip }, async () => {
    // The independent reader above shares no code with unzip; this one run
    // against the real tool catches a structural mistake both might make.
    const dir = await mkdtemp(join(tmpdir(), "vault-zip-"));
    const archive = join(dir, "m.zip");
    await writeFile(archive, zip([{ name: "a/b.json", data: Buffer.from("x".repeat(5000)) }]));
    const { stdout } = await run("unzip", ["-t", archive]);
    assert.match(stdout, /No errors detected/);
  });

  it("declares its names as UTF-8", () => {
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

  it("is byte-identical for identical content", () => {
    // The archive's hash is what tells a reader the module changed. A clock in
    // the header would announce a new version on every rebuild.
    const entries = [{ name: "a.json", data: Buffer.from("{}") }];
    assert.deepEqual(zip(entries), zip(entries));
  });
});
