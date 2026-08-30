// A minimal zip writer, for the module a vault ships: two small JSON files,
// stored uncompressed. The `zip` binary is absent on Windows and many CI
// images, which is why this exists.

// Added in Node 22.2.0, which is why package.json asks for it exactly.
import { crc32 } from "node:zlib";

export interface ZipEntry { name: string; data: Buffer }

// MS-DOS time, which is what the format stores. A fixed timestamp keeps the
// archive byte-identical between builds of identical content, so a reader is
// not told there is a new version because the clock moved.
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01

// Bit 11 says the filename is UTF-8. Without it a reader decodes the name as
// CP437, so anything outside ASCII extracts under a mangled name — and the
// archive still looks fine until someone's vault is called something with an
// accent in it.
const UTF8_NAMES = 0x0800;

function localHeader(entry: ZipEntry, crc: number): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);   // local file header
  head.writeUInt16LE(20, 4);           // version needed
  head.writeUInt16LE(UTF8_NAMES, 6);
  head.writeUInt16LE(0, 8);            // method: stored
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(entry.data.length, 18);
  head.writeUInt32LE(entry.data.length, 22);
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28);           // extra length
  return Buffer.concat([head, name]);
}

function centralHeader(entry: ZipEntry, crc: number, offset: number): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);   // central directory header
  head.writeUInt16LE(20, 4);           // version made by
  head.writeUInt16LE(20, 6);           // version needed
  head.writeUInt16LE(UTF8_NAMES, 8);
  head.writeUInt16LE(0, 10);           // method: stored
  head.writeUInt16LE(DOS_TIME, 12);
  head.writeUInt16LE(DOS_DATE, 14);
  head.writeUInt32LE(crc, 16);
  head.writeUInt32LE(entry.data.length, 20);
  head.writeUInt32LE(entry.data.length, 24);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt16LE(0, 30);           // extra
  head.writeUInt16LE(0, 32);           // comment
  head.writeUInt16LE(0, 34);           // disk number
  head.writeUInt16LE(0, 36);           // internal attrs
  head.writeUInt32LE(0o644 << 16, 38); // external attrs
  head.writeUInt32LE(offset, 42);
  return Buffer.concat([head, name]);
}

/** Build a zip archive holding the given entries, stored uncompressed. */
export function zip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const crc = crc32(entry.data) >>> 0;
    const header = localHeader(entry, crc);
    local.push(header, entry.data);
    central.push(centralHeader(entry, crc, offset));
    offset += header.length + entry.data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);    // end of central directory
  end.writeUInt16LE(0, 4);             // disk
  end.writeUInt16LE(0, 6);             // disk with directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);            // comment length

  return Buffer.concat([...local, directory, end]);
}
