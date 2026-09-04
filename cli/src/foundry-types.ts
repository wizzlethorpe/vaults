// The one table of Foundry document types the build knows: the packs a
// module declares, and the types a bare `foundry.source` may name.

/** Pack name suffix per document type: `<moduleId>-<suffix>`. */
export const DOC_TYPES: Record<string, string> = {
  JournalEntry: "journals",
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  RollTable: "tables",
  Macro: "macros",
  Playlist: "playlists",
  Cards: "cards",
};

/** Suffix of the one pack an adventure-packaged vault declares. */
export const ADVENTURE_PACK = "adventure";

/** How a vault is delivered: browsable packs, or one Adventure. */
export type Packaging = "compendium" | "adventure";

/**
 * Fold a type segment to its canonical spelling, or null if a page cannot
 * invent that type. Case is folded because `source: actor:npc` is supported
 * but Foundry's `@UUID[...]` lookup is case-sensitive downstream.
 */
export function canonicalType(raw: string | undefined): string | null {
  if (!raw) return null;
  return Object.keys(DOC_TYPES).find((t) => t.toLowerCase() === raw.toLowerCase()) ?? null;
}
