// One progress notification for the length of a sync.
//
// A sync used to show "Starting sync", then nothing at all until "Done". For a
// vault with images to fetch — or, now, a page whose assets resolve out of the
// reader's Moulinette library — that is a minute or more of a UI that looks
// frozen, with no way to tell a slow sync from a stuck one.
//
// State is module-level rather than threaded through call signatures. The
// places that know *what* is happening (an image upload in media.mjs, an asset
// download in moulinette.mjs) sit several frames below the loop that knows
// *how far along* we are, and passing a reporter down through every signature
// in between would cost more than it explains. One sync runs at a time, which
// is what makes a singleton honest here.
//
// Everything degrades to a no-op. Progress notifications are a Foundry 13
// feature, and this must not be the reason a sync fails on a world that does
// not have them.

/** The Foundry notification handle, or null when unavailable. */
let bar = null;
let vaultLabel = "";
let phaseLabel = "";
let done = 0;
let total = 0;

function paint(message) {
  if (!bar) return;
  const counter = total > 0 ? ` ${Math.min(done, total)}/${total}` : "";
  const head = phaseLabel ? `${vaultLabel}: ${phaseLabel}${counter}` : vaultLabel;
  try {
    bar.update({
      pct: total > 0 ? Math.min(done / total, 1) : 0,
      message: message ? `${head} — ${message}` : head,
    });
  } catch {
    // A changed notification API should cost us the bar, not the sync.
    bar = null;
  }
}

/** Open the bar for a sync. Safe to call when the API is absent. */
export function begin(label) {
  vaultLabel = label;
  phaseLabel = "";
  done = 0;
  total = 0;
  try {
    const handle = ui?.notifications?.info(label, { progress: true, permanent: true });
    bar = typeof handle?.update === "function" ? handle : null;
  } catch {
    bar = null;
  }
}

/**
 * Start a named phase of `count` items. The bar restarts within the phase
 * rather than pretending to one overall total: images, pages and deletions
 * have no shared unit, and a weighted denominator would be a guess presented
 * as a measurement.
 */
export function phase(name, count) {
  phaseLabel = name;
  done = 0;
  total = count;
  paint("");
}

/** Advance one item. `message` names what is being worked on. */
export function step(message) {
  done++;
  paint(message);
}

/** Change the message without advancing — for work nested inside one item. */
export function note(message) {
  paint(message);
}

/** Close the bar. Idempotent, and safe to call on a path that never opened one. */
export function end() {
  if (!bar) return;
  try { ui?.notifications?.remove?.(bar); } catch { /* already gone */ }
  bar = null;
  phaseLabel = "";
}
