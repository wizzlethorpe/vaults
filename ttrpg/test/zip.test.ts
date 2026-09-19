// The asset archives the build ships for graft's http handler.
//
// zip.ts is written by hand because the `zip` binary is missing on Windows and
// on many CI images, which is also why these tests cannot lean on `unzip`:
// it is missing on exactly the machines zip.ts exists for. Extraction here
// goes through node's zlib, an implementation zip.ts does not share, and the
// one test that wants a real unzip skips without it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { crc32, inflateRawSync } from "node:zlib";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { chunkAssets, zip } from "../src/zip.js";

const run = promisify(execFile);
const haveUnzip = await run("unzip", ["-v"]).then(() => true, () => false);

/** Bytes that are not text, the way an asset chunk's members are not. */
const binary = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 37) % 256));

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
      { name: "attachments/map.webp", data: binary(5000) },
      { name: "attachments/theme.ogg", data: binary(1200) },
      { name: "scenes/keep.webp", data: Buffer.from("not really a webp") },
    ];
    const files = extract(zip(entries));
    for (const e of entries) {
      assert.deepEqual(files.get(e.name), e.data);
    }
  });

  it("handles an empty file", () => {
    assert.equal(extract(zip([{ name: "attachments/empty.webp", data: Buffer.alloc(0) }])).get("attachments/empty.webp")!.length, 0);
  });

  it("passes a real unzip's integrity check", { skip: !haveUnzip }, async () => {
    // The independent reader above shares no code with unzip; this one run
    // against the real tool catches a structural mistake both might make.
    const dir = await mkdtemp(join(tmpdir(), "vault-zip-"));
    const archive = join(dir, "assets.zip");
    await writeFile(archive, zip([{ name: "attachments/map.webp", data: binary(5000) }]));
    const { stdout } = await run("unzip", ["-t", archive]);
    assert.match(stdout, /No errors detected/);
  });

  it("declares its names as UTF-8", () => {
    // Asserted on the bytes rather than by extracting: Info-ZIP's `unzip`
    // ignores this flag and decodes names as CP437 regardless, so a round trip
    // through it would fail on a correct archive. Readers that do honour it
    // (Foundry's included) need the bit set or an accented file name extracts
    // mangled.
    const archive = zip([{ name: "attachments/Café.webp", data: Buffer.from("{}") }]);
    assert.equal(archive.readUInt16LE(6) & 0x0800, 0x0800, "local header");
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.equal(archive.readUInt16LE(central + 8) & 0x0800, 0x0800, "central directory");
  });

  it("carries no clock, so identical content is byte-identical across pushes", () => {
    // A chunk is named by its own hash. A timestamp in the header would give
    // every asset a new URL on every push and refetch the lot. Two calls a
    // millisecond apart would still match, so the fields are read directly.
    const entries = [{ name: "attachments/map.webp", data: binary(64) }];
    const archive = zip(entries);
    assert.deepEqual(archive, zip(entries));
    assert.equal(archive.readUInt16LE(10), 0, "local header time");
    assert.equal(archive.readUInt16LE(12), 0x21, "local header date");
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.equal(archive.readUInt16LE(central + 12), 0, "central directory time");
    assert.equal(archive.readUInt16LE(central + 14), 0x21, "central directory date");
  });
});

describe("chunkAssets", () => {
  const f = (path: string, size: number) => ({ path, size });
  /** What the archive of a chunk actually weighs: content plus its headers. */
  const weigh = (chunk: { path: string; size: number }[]) =>
    22 + chunk.reduce((n, x) => n + x.size + 76 + 2 * Buffer.byteLength(x.path), 0);

  it("fills each chunk up to the limit and starts another past it", () => {
    const chunks = chunkAssets([f("a", 100), f("b", 100), f("c", 100)], 400);
    assert.deepEqual(chunks.map((c) => c.map((x) => x.path)), [["a", "b"], ["c"]]);
  });

  it("counts the archive, not the content: Pages refuses the deployed file", () => {
    // A chunk filled to the limit with content alone deploys over it, and the
    // push fails on the one file the reader most needs.
    const sizes = [700, 300, 900, 100, 500, 500, 200, 800];
    const chunks = chunkAssets(sizes.map((n, i) => f(`attachments/${i}.webp`, n)), 1000);
    assert.ok(chunks.length > 0, "nothing was chunked at all");
    for (const chunk of chunks) assert.ok(weigh(chunk) <= 1000, `chunk weighs ${weigh(chunk)}`);
  });

  it("leaves out a file too big for any chunk, rather than failing the build", () => {
    // Its own URL still serves it; it just is not batched.
    const chunks = chunkAssets([f("small", 200), f("huge", 5000), f("also", 300)], 1000);
    assert.deepEqual(chunks.flat().map((x) => x.path), ["small", "also"]);
  });

  it("makes no chunks from nothing", () => {
    assert.deepEqual(chunkAssets([], 1000), []);
  });
});
