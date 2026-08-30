// Packaging a vault as one Adventure instead of a shelf of packs.
//
// Foundry's import partitions by `_id`: what the world already has is updated,
// the rest created. Our ids are deterministic, so a second import updates in
// place rather than making a second everything.

import { DOC_TYPES } from "./foundry-types.js";
import type { GraftEntry } from "./foundry-grafts.js";

/** Adventure schema field per document type. */
const CONTENT_FIELD: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(DOC_TYPES).map(([type, info]) => [type, info.adventureField]),
);

export interface AdventureOptions {
  /** Document id for the Adventure itself. */
  id: string;
  pack: string;
  name: string;
  /** Shown on the import dialog. */
  description?: string;
  /** Stamped as the wrapper's own _stats.coreVersion, when the vault says. */
  coreVersion?: string;
  /** Deterministic id for the folder of `type` at `path`. */
  folderId: (type: string, path: string) => string;
}

/**
 * Folder documents for every path the entries name, and their parents.
 *
 * Foundry folders are typed, so `Places` holding Scenes and `Places` holding
 * JournalEntries are two folders, and a nested document points at one by id
 * rather than by the path graft resolves at the top level.
 */
function folderDocs(
  entries: GraftEntry[], folderId: AdventureOptions["folderId"],
): Record<string, unknown>[] {
  const docs = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    if (!entry.folder || !CONTENT_FIELD[entry.type]) continue;
    const segments = entry.folder.split("/");
    for (let i = 0; i < segments.length; i++) {
      const path = segments.slice(0, i + 1).join("/");
      const key = `${entry.type}/${path}`;
      if (docs.has(key)) continue;
      docs.set(key, {
        _id: folderId(entry.type, path),
        name: segments[i]!,
        type: entry.type,
        sorting: "a",
        ...(i > 0 ? { folder: folderId(entry.type, segments.slice(0, i).join("/")) } : {}),
      });
    }
  }
  return [...docs.values()];
}

/**
 * Fold typed entries into a single Adventure entry.
 *
 * A sourced entry stays `{ _id, source, patch }` — the shape graft resolves
 * inside a keyed array — so an Actor keeps naming its statblock and is still
 * resolved on the reader's machine, where the compendium is.
 */
export function asAdventure(
  entries: GraftEntry[], opts: AdventureOptions,
): { entries: GraftEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const content: Record<string, Record<string, unknown>[]> = {};

  for (const entry of entries) {
    const field = CONTENT_FIELD[entry.type];
    if (!field) {
      warnings.push(`${entry.id}: an Adventure has nowhere to put a ${entry.type}; it was left out`);
      continue;
    }
    // graft resolves one source per nested entry, not a priority list: the
    // list form exists so a reader who lacks the better content still gets
    // something, and inside an Adventure that choice has already been made.
    const source = Array.isArray(entry.source) ? entry.source[0] : entry.source;
    if (Array.isArray(entry.source) && entry.source.length > 1) {
      warnings.push(
        `${entry.id}: an Adventure takes one source, so the ${entry.source.length - 1}`
        + ` fallback(s) after ${source} were dropped`);
    }
    // `expandSources` reads only `_id`, `source` and `patch`, so a sourced
    // entry's folder has to travel inside the patch to survive resolution.
    const folder = entry.folder ? { folder: opts.folderId(entry.type, entry.folder) } : {};
    (content[field] ??= []).push(source
      ? { _id: entry.id, source, patch: { ...entry.patch, ...folder } }
      : { _id: entry.id, ...entry.patch, ...folder });
  }

  const folders = folderDocs(entries, opts.folderId);

  return {
    entries: [{
      id: opts.id,
      type: "Adventure",
      pack: opts.pack,
      patch: {
        name: opts.name,
        ...(opts.coreVersion ? { _stats: { coreVersion: opts.coreVersion } } : {}),
        ...(opts.description ? { description: opts.description } : {}),
        ...(folders.length ? { folders } : {}),
        ...content,
      },
    }],
    warnings,
  };
}
