// The one table of Foundry document types the build knows: the types a bare
// `foundry.source` may name.

/** The document types a vault can build. */
export const DOC_TYPES = [
  "JournalEntry", "Actor", "Item", "Scene", "RollTable", "Macro", "Playlist", "Cards",
] as const;

/**
 * Fold a type segment to its canonical spelling, or null if a page cannot
 * invent that type. Case is folded because `source: actor:npc` is supported
 * but Foundry's `@UUID[...]` lookup is case-sensitive downstream.
 */
export function canonicalType(raw: string | undefined): string | null {
  if (!raw) return null;
  return DOC_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase()) ?? null;
}
