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
