// Canonical reading of `foundry.base`.
//
// This was implemented five times — in instance.mjs, links.mjs, importer.mjs,
// cli/src/build.ts and foundry-compiler — and the copies disagreed, which is
// how two bugs got in:
//
//   - `base: actor:npc` (lowercase, supported and asserted in the tests):
//     instance.mjs case-folded and made an Actor, links.mjs did not and emitted
//     `@UUID[actor.<id>]`. Foundry's enricher lookup is case-sensitive, so
//     every inbound wikilink to that page was dead while the page itself
//     looked fine.
//   - `base: [<uuid>, "Actor:npc"]` (a priority list): links.mjs handled the
//     array, importer.mjs returned null for anything non-string, so the
//     "Open in Foundry" footer link silently vanished for exactly the pages
//     using the newest feature.
//
// The three Foundry-side callers now share this module. cli/src/build.ts and
// foundry-compiler still have their own copies — they are TypeScript packages
// with `rootDir: ./src`, so importing this would mean reshaping their
// tsconfigs — but foundry/test/foundry-base.test.mjs pins the agreed answers
// so a future divergence fails a test rather than a user's wikilinks.

/**
 * The compendium pack each document type belongs to, as a name fragment.
 *
 * Shared so that a vault synced into a world and the same vault compiled into
 * a module land in packs with matching names: sync scopes them by vault id
 * ("seylon-wiki-71c13dcb-journal"), the compiler by module id
 * ("wands-journal"). The CLI keeps its own copy for the reason described
 * above, held to this one by cli/test/foundry-base-conformance.test.ts.
 */
export const PACK_KEY = {
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal",
  RollTable: "tables",
  Macro: "macros",
  Cards: "cards",
  Playlist: "playlists",
};

/** Document types `foundry.base: <Type>[:<subtype>]` can create. */
export const BLANK_DOC_TYPES = [
  "Actor", "Item", "Scene", "JournalEntry",
  "RollTable", "Macro", "Cards", "Playlist",
];

/** Fold a spec's type segment to its canonical spelling, or null. */
function canonicalType(raw) {
  if (!raw) return null;
  return BLANK_DOC_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase()) ?? null;
}

/**
 * Parse one `foundry.base` spec.
 *
 * UUIDs always contain a "." (`Type.id` at minimum); a bare type name like
 * "Actor" or "Item:weapon" never does. Case-insensitive for the type, so
 * `actor:npc` reads naturally in YAML.
 *
 * Returns null for unrecognised input. The caller warns, since only it knows
 * which page the bad value came from.
 */
export function parseFoundryBase(spec) {
  if (typeof spec !== "string" || !spec) return null;
  // Checked before the UUID rule: a Moulinette reference contains dots (its
  // file segment ends in .json), so the dot test would claim it as a UUID.
  if (spec.startsWith("@moulinette/")) {
    const ref = spec.slice("@moulinette/".length);
    return ref ? { kind: "moulinette", ref } : null;
  }
  if (spec.includes(".")) return { kind: "uuid", uuid: spec };
  const [typeRaw, subtype] = spec.split(":");
  const docName = canonicalType(typeRaw);
  if (!docName) return null;
  return { kind: "blank", docName, subtype: subtype || undefined };
}

/**
 * The document type a parsed spec names, without resolving anything. Every
 * UUID form puts the type second-to-last (`Actor.<id>`,
 * `Compendium.<pkg>.<pack>.Actor.<id>`, `Actor.<id>.Item.<id>`), and a
 * blank-doc spec carries it outright.
 */
export function docNameOf(parsed) {
  if (!parsed) return null;
  if (parsed.kind === "blank") return parsed.docName;
  // A Moulinette reference names no type. Its path happens to read
  // `json/scene/...`, but that is one creator's export convention, not a
  // contract, and the type is only knowable by looking the asset up in the
  // reader's index — which the CLI, where this also runs, cannot do. The
  // type comes from another rung instead; see docNameFromBase.
  if (parsed.kind === "moulinette") return null;
  const parts = parsed.uuid.split(".");
  if (parts.length < 2) return null;
  // Canonicalise so a hand-typed `actor.abc…` agrees with `Actor:npc`; fall
  // back to the raw segment for a document type vaults doesn't instantiate
  // but Foundry might still resolve.
  const raw = parts[parts.length - 2];
  return canonicalType(raw) ?? raw ?? null;
}

/**
 * The document type a whole `foundry.base` names, accepting either one spec
 * or a priority list. A list names one type across all its entries (the CLI
 * rejects a mixed one), so its first entry answers for the page.
 */
export function docNameFromBase(base) {
  const specs = Array.isArray(base) ? base : [base];
  // The first entry that *names* a type, not simply the first entry. A
  // Moulinette rung names none, so a list led by one would otherwise report
  // no type and drop the whole base. The CLI rejects a list whose entries
  // disagree, so the first answer is the only answer.
  for (const spec of specs) {
    const docName = docNameOf(parseFoundryBase(spec));
    if (docName) return docName;
  }
  return null;
}
