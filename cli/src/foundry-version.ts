// The version a vault's Foundry module carries: the date the module itself
// last changed. Foundry decides "update available" with isNewerVersion, so it
// has to be orderable (a hash can never say yes), and pushing content does
// not touch it, so an update offer always contains one.

import { createHash } from "node:crypto";

export interface ModuleVersion {
  /** e.g. "2026.8.29", or "2026.8.29.1" for a second change the same day. */
  version: string;
  /** Fingerprint of the manifest this version describes. */
  hash: string;
}

/** Everything about a manifest except the version it is being assigned. */
function fingerprint(manifest: Record<string, unknown>): string {
  const { version: _drop, ...rest } = manifest;
  return createHash("md5").update(JSON.stringify(rest)).digest("hex").slice(0, 12);
}

/**
 * The version this manifest should carry: unchanged while the manifest is,
 * today's date when it moved, with a same-day counter so it stays ordered.
 */
export function moduleVersion(
  manifest: Record<string, unknown>, previous: ModuleVersion | undefined, now = new Date(),
): ModuleVersion {
  const hash = fingerprint(manifest);
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
