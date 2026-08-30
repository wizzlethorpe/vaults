// The version a vault's Foundry module carries.
//
// It used to be the deploy's asset hash, which is unreadable in Foundry's
// module list and — worse — cannot be ordered. Foundry decides whether an
// update is available with `isNewerVersion`, so a hash means "check for
// updates" can never say yes.
//
// The module is inert: a manifest, a set of pack declarations, and one line
// naming the vault. Pushing content does not change it, so its version should
// not move on every push either. It moves when the module itself changes —
// gaining a pack, being renamed, moving to a new URL — and it reads as the day
// that happened.

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
 * The version this manifest should carry, given the last one it was assigned.
 *
 * Unchanged manifest, unchanged version: a module that offers an update
 * containing nothing is a module people learn to ignore. When it has changed,
 * today's date, with a counter only if that collides with the version already
 * in use — which keeps it ordered on the one day it could go backwards.
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
