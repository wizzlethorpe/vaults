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
