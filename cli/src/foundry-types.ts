// The one table of Foundry document types the build knows.
//
// Three things used to each keep their own list — the packs a module
// declares, the Adventure schema's content fields, and the types a bare
// `foundry.source` may name — and they had already drifted apart.

interface DocTypeInfo {
  /** Pack name suffix: `<moduleId>-<suffix>`. */
  packSuffix: string;
  /** Field name in an Adventure's schema, from Adventure.contentFields. */
  adventureField?: string;
}

export const DOC_TYPES: Record<string, DocTypeInfo> = {
  JournalEntry: { packSuffix: "journals", adventureField: "journal" },
  Actor: { packSuffix: "actors", adventureField: "actors" },
  Item: { packSuffix: "items", adventureField: "items" },
  Scene: { packSuffix: "scenes", adventureField: "scenes" },
  RollTable: { packSuffix: "tables", adventureField: "tables" },
  Macro: { packSuffix: "macros", adventureField: "macros" },
  Playlist: { packSuffix: "playlists", adventureField: "playlists" },
  Cards: { packSuffix: "cards", adventureField: "cards" },
  // Where a vault delivered as one Adventure puts it. Not a blank-doc type:
  // a page cannot invent an Adventure.
  Adventure: { packSuffix: "adventure" },
};

/**
 * Fold a type segment to its canonical spelling, or null if a page cannot
 * invent that type. Case is folded because `source: actor:npc` is supported
 * but Foundry's `@UUID[...]` lookup is case-sensitive downstream.
 */
export function canonicalType(raw: string | undefined): string | null {
  if (!raw) return null;
  const hit = Object.keys(DOC_TYPES).find((t) => t.toLowerCase() === raw.toLowerCase());
  return hit && hit !== "Adventure" ? hit : null;
}
