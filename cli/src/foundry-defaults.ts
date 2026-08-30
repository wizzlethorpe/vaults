// Default patches: what a document gets before its page says anything.
//
// Layered by how specific they are, least first, with the page's own patch last
// and winning:
//
//   Actor            → every Actor in any system
//   dnd5e/Actor      → every Actor in a vault targeting dnd5e
//   the page's patch → this one
//
// Data rather than code, which is what makes this small. "Only use the page's
// portrait if the page did not name its own" is not a condition anyone writes
// here — it is what merging in this order already means. So is turning one off:
// a page that says `img: null` has stated a value, the default does not reach
// past it, and null is how a patch spells "no value" everywhere else too.
//
// `@page/…` is a value only the page can supply. It resolves during the build,
// and a reference that resolves to nothing takes its key with it, so a page
// with no portrait simply has no `img` rather than an empty one.

/** Values a page can lend to its own default patch. */
export interface PageValues {
  /** Representative image, as a served URL ("/attachments/x.webp"). */
  image?: string | null;
  /** The page's rendered article, as a vault reference. */
  body?: string;
}

const PAGE_REF = /^@page\/([a-z]+)$/;

export const DEFAULT_PATCHES: Record<string, Record<string, unknown>> = {
  // A token is cut round and padded where a portrait is not, so this is a
  // stand-in for a page with no token art of its own, never a replacement.
  Actor: {
    img: "@page/image",
    prototypeToken: { texture: { src: "@page/image" } },
  },
  Item: { img: "@page/image" },
  JournalEntry: {},

  // The page's article becomes the document's description, so a statblock
  // opened in Foundry carries the writing that explains it. As a reference, in
  // the same role variant the journal page uses, so a player-visible document
  // cannot end up holding the GM's version of its own page.
  "dnd5e/Actor": { system: { details: { biography: { value: "@page/body" } } } },
  "dnd5e/Item": { system: { description: { value: "@page/body" } } },
};

/** The default patches for a type, least specific first. */
export function defaultsFor(type: string, system: string): Record<string, unknown>[] {
  return [DEFAULT_PATCHES[type], DEFAULT_PATCHES[`${system}/${type}`]]
    .filter((p): p is Record<string, unknown> => !!p);
}

/**
 * Replace `@page/…` with what the page supplies, dropping what it cannot.
 *
 * Returns a new value. A key whose reference resolves to nothing is removed,
 * and an object emptied by that is removed in turn: a default that a page
 * cannot satisfy should leave no trace, not a hollow `{ texture: {} }`.
 */
export function resolvePageRefs<T>(value: T, page: PageValues): T | undefined {
  if (typeof value === "string") {
    const name = PAGE_REF.exec(value)?.[1];
    if (!name) return value;
    const resolved = name === "image"
      ? imageRef(page.image)
      : name === "body" ? page.body : undefined;
    return (resolved ?? undefined) as T | undefined;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolvePageRefs(v, page)).filter((v) => v !== undefined) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = resolvePageRefs(v, page);
      if (next !== undefined) out[k] = next;
    }
    return (Object.keys(out).length > 0 ? out : undefined) as T | undefined;
  }
  return value;
}

/** A page image as a vault reference, or an external URL left as it is. */
function imageRef(image: string | null | undefined): string | undefined {
  if (!image) return undefined;
  return /^https?:\/\//i.test(image) ? image : `@vault/${image.replace(/^\/+/, "")}`;
}
