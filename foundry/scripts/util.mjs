// Shared helpers for the Foundry-side scripts. The CLI ships its own copy
// in cli/src/escape.ts; we can't share across the cli/foundry boundary
// (Foundry loads .mjs directly from this directory at runtime), so this
// module is the Foundry-side single source of truth.

/** Escape a string for use as an HTML attribute value (& < > "). */
export function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Escape a string for use as HTML text content (& < >). */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/** Strip `{` and `}` so a label is safe to inline into a Foundry
 *  `@UUID[…]{…}` enricher. We strip rather than escape because Foundry
 *  has no escape for those characters; a stripped label still reads. */
export function escapeBraces(s) {
  return String(s).replace(/[{}]/g, "");
}

/** Hex SHA digest. Uses the SubtleCrypto API available in Foundry's
 *  browser context (V13+). */
export async function hexDigest(algorithm, text) {
  const buf = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Localize a key, falling back to English text when the installed module
 * predates it.
 *
 * The sync code is bundled by the CLI and shipped with the *vault*, while
 * `lang/en.json` ships with the *installed module*. The two update on
 * different schedules by design, so a message introduced by the bundle
 * reaches a module that has never heard of its key — and Foundry's i18n
 * returns the key itself when it cannot find one, so the GM is shown a
 * warning that reads `VAULTS.Sync.VersionSkew`.
 *
 * The key is still tried first, so a current module translates properly and
 * a translated vault stays translated. The fallback only carries the strings
 * the bundle introduced, which is exactly the set the module may lack.
 */
export function localizeOr(host, key, fallback, args) {
  const text = host.localize(key, args);
  if (text && text !== key) return text;
  return String(fallback).replace(/\{(\w+)\}/g, (whole, name) =>
    (args && name in args ? String(args[name]) : whole));
}
