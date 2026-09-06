// The version a vault's Foundry module carries: the date the module itself
// last changed. Foundry decides "update available" with isNewerVersion, so it
// has to be orderable (a hash can never say yes), and pushing content does
// not touch it, so an update offer always contains one.
//
// Foundry re-fetches the archive only when the version moves, so every file
// the module ships feeds the fingerprint, not just the manifest.

import { createHash } from "node:crypto";

import type { ZipEntry } from "./zip.js";

export interface ModuleVersion {
  /** e.g. "2026.8.29", or "2026.8.29.1" for a second change the same day. */
  version: string;
  /** Fingerprint of the files this version describes. */
  hash: string;
}

function fingerprint(files: ZipEntry[]): string {
  const hash = createHash("md5");
  for (const file of files) hash.update(file.name).update("\0").update(file.data).update("\0");
  return hash.digest("hex").slice(0, 12);
}

/**
 * The version this module should carry: unchanged while its files are, today's
 * date when they moved, with a same-day counter so it stays ordered.
 *
 * The files must not yet carry the version being assigned, or stamping one
 * changes them, which demands another, forever.
 */
export function moduleVersion(
  files: ZipEntry[], previous: ModuleVersion | undefined, now = new Date(),
): ModuleVersion {
  const hash = fingerprint(files);
  if (previous && previous.hash === hash) return previous;

  const today = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
  // Segment-exact, not a prefix test: "2026.8.29" starts with "2026.8.2", and
  // a clock that went backwards would read its counter out of the day field.
  const sameDay = previous
    && (previous.version === today || previous.version.startsWith(`${today}.`));
  if (!sameDay) return { version: today, hash };

  // Same day, changed again: 2026.8.29 → 2026.8.29.1 → 2026.8.29.2
  const nth = Number(previous!.version.slice(today.length).replace(/^\./, "")) || 0;
  return { version: `${today}.${nth + 1}`, hash };
}

/** Foundry's isNewerVersion: segment-wise, numeric where both sides parse. */
export function ordersAbove(version: string, previous: string): boolean {
  const [a, b] = [version.split("."), previous.split(".")];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? "0", b[i] ?? "0"];
    const [nx, ny] = [Number(x), Number(y)];
    if (Number.isNaN(nx) || Number.isNaN(ny)) { if (x !== y) return x > y; }
    else if (nx !== ny) return nx > ny;
  }
  return false;
}
