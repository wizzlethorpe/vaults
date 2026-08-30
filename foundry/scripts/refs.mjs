// Vault references: `@vaults/<variant>/<path>`, resolved on the reader's
// machine because only the reader knows where a downloaded file lands.
//
// The variant is the role whose rendering to fetch, and must be asked for
// specifically: fetching without it serves whatever the reader's own token
// reaches, which for a GM is everything, including what a player-visible
// document must not carry. Nothing here touches Foundry or the network.

const PREFIX = "@vaults/";

// A reference is rarely a whole value. Most live inside a page body, as the
// src of an <img> or the href of a link, so matching only values that *are* a
// reference leaves every image in every page pointing at nothing. The
// terminators are the characters that can end one in HTML or in JSON.
const REF_RE = /@vaults\/([^/"'\s<>]+)\/([^"'\s<>]+)/g;

/** A body is inlined as text; anything else is a file to download. */
export const isBody = (path) => /\.foundry\.html$/i.test(path);

/**
 * Split a reference into its variant and path, or null if it is not one.
 *
 * A reference with no path after the variant is not a reference to anything,
 * and is rejected rather than resolved to the variant's root.
 */
export function parseRef(value) {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return null;
  const rest = value.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const variant = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  return path ? { variant, path: decodePath(path) } : null;
}

/**
 * A reference's path as the vault stores it.
 *
 * Inside a body the path arrives percent-encoded, because it was written as a
 * URL: `Bixby%20Wizzlethorpe.webp`. The vault serves a file whose name has a
 * space in it, so asking for the encoded form is asking for a file that does
 * not exist — and `/_batch` answers a missing file by omitting it, not by
 * failing, so the whole thing would go quietly missing.
 */
function decodePath(path) {
  try { return decodeURIComponent(path); } catch { return path; }
}

/** Every reference inside a string, wherever it appears. */
export function findRefs(text) {
  const out = [];
  for (const [raw, variant, path] of text.matchAll(REF_RE)) {
    out.push({ raw, variant, path: decodePath(path) });
  }
  return out;
}

/** Every distinct reference reachable from a value, in encounter order. */
export function collectRefs(value, into = new Map()) {
  if (typeof value === "string") {
    // Whole value first, and only then a scan. A value that *is* a reference
    // may hold a raw space — `@vaults/DM/tokens/Cassius Marlo.token.webp` is
    // what a frontmatter `@vault/` path becomes — while one embedded in HTML
    // is a URL, where a space ends the attribute. Scanning first truncates the
    // former at its space, and asks the vault for a file that does not exist.
    const whole = parseRef(value);
    if (whole) {
      if (!into.has(value)) into.set(value, whole);
      return into;
    }
    for (const { raw, variant, path } of findRefs(value)) {
      if (!into.has(raw)) into.set(raw, { variant, path });
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectRefs(v, into);
  }
  return into;
}

/**
 * Replace every reference with its resolved value.
 *
 * A reference with nothing in `resolved` is left as it is. It will not render,
 * but it is still legible in the document as the thing that failed, which a
 * blank or a broken relative path would not be.
 */
export function substituteRefs(value, resolved) {
  if (typeof value === "string") {
    if (!value.includes(PREFIX)) return value;
    // Whole-value first: a body is replaced by the HTML it names, which is
    // large and must not go through a regex replacement that would treat `$&`
    // in the page's own prose as a backreference.
    if (resolved.has(value)) return resolved.get(value);
    return value.replace(REF_RE, (raw) => (resolved.has(raw) ? resolved.get(raw) : raw));
  }
  if (Array.isArray(value)) return value.map((v) => substituteRefs(v, resolved));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substituteRefs(v, resolved)]),
    );
  }
  return value;
}

/**
 * Group references by the variant they read from.
 *
 * One request per variant, not one per file: `/_batch` takes a role and a list
 * of paths, and a vault with three roles is three requests however many pages
 * it holds.
 */
export function byVariant(refs) {
  const out = new Map();
  for (const { variant, path } of refs.values()) {
    if (!out.has(variant)) out.set(variant, new Set());
    out.get(variant).add(path);
  }
  return out;
}
