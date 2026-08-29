// Compile a vault into a grafts.json: the entry list graft builds from.
//
// This replaces both halves of the old Foundry integration. The module used to
// fetch a manifest, diff it, pull bodies, rewrite links and write packs at
// runtime, while the compiler did much the same work again to produce an
// installable module. Both become one artifact emitted here, and the Foundry
// side becomes "fetch this list and hand it to graft".
//
// Nothing in this file touches Foundry or the filesystem, so the whole mapping
// is testable on its own — which is where the old design had no coverage at all.

import { createHash } from "node:crypto";

/** One graft entry. `source` absent means the patch *is* the document. */
export interface GraftEntry {
  id: string;
  type: string;
  pack: string;
  folder?: string;
  source?: string;
  patch: Record<string, unknown>;
}

export interface GraftsFile {
  format: 1;
  version: string;
  entries: GraftEntry[];
}

/** Just enough of a page to place it. */
export interface Page {
  path: string;                    // "Characters/Nobles/Marlo.md"
  title: string;
  role: string;
  /** The `foundry:` frontmatter block, if any. */
  foundry?: { base?: string; data?: Record<string, unknown> } | null;
}

export interface GraftOptions {
  vaultId: string;
  /** Role names, least privileged first. The last is what the GM builds as. */
  roles: string[];
  /** Roles at or below this one are visible to players. */
  playerRole: string;
  /** Pack name per document type, e.g. `{ JournalEntry: "marlo-journals" }`. */
  packs: Record<string, string>;
  version: string;
}

const OBSERVER = 2;
const NONE = 0;

/**
 * Deterministic 16-character Foundry ids.
 *
 * Stable across pushes, because an id that moved would orphan what it built:
 * pruning deletes the old document and hydration creates a new one, breaking
 * every link a reader had to it. Derived from the path, never the content.
 */
const det = (kind: string, key: string): string =>
  createHash("sha1").update(`vaults:${kind}:${key}`).digest("hex").slice(0, 16);

export const entryId = (vaultId: string, folder: string) => det("entry", `${vaultId}:${folder}`);
export const pageId = (vaultId: string, path: string) => det("page", `${vaultId}:${path}`);
export const instanceId = (vaultId: string, path: string) => det("instance", `${vaultId}:${path}`);

export const folderOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

/**
 * Which rendered variant a page's body comes from, and whether players may see
 * the result.
 *
 * These are one decision, not two. A player-observable document must carry the
 * body a *player* would have been served, or a `[!dm]` block reaches the table:
 * the GM's token can fetch any variant, so choosing the wrong one leaks
 * silently. Anything above the player ceiling takes the GM's own variant and
 * stays hidden.
 */
export function visibility(page: Page, opts: GraftOptions): { variant: string; ownership: number } {
  const rank = (role: string) => opts.roles.indexOf(role);
  const gmRole = opts.roles[opts.roles.length - 1] ?? opts.playerRole;
  const observable = rank(page.role) >= 0 && rank(page.role) <= rank(opts.playerRole);
  return observable
    ? { variant: opts.playerRole, ownership: OBSERVER }
    : { variant: gmRole, ownership: NONE };
}

/** `"Characters/Nobles/Marlo.md"` to `"Characters/Nobles"`, or undefined at the root. */
const graftFolder = (folder: string): string | undefined => folder || undefined;

/**
 * One JournalEntry per directory, every `.md` in it an embedded page.
 *
 * The folder-as-entry model the sync already used: a directory of notes reads
 * as one journal a GM can page through, rather than fifty entries in a list.
 *
 * Bodies are references, not content. Inlining them would make this file
 * megabytes for a large vault and re-download every page on every build; a
 * reference lets the provider batch them through `/_batch` and skip what has
 * not changed.
 */
export function journalEntries(pages: Page[], opts: GraftOptions): GraftEntry[] {
  const pack = opts.packs["JournalEntry"];
  if (!pack) return [];

  const byFolder = new Map<string, Page[]>();
  for (const page of pages) {
    const folder = folderOf(page.path);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder)!.push(page);
  }

  const entries: GraftEntry[] = [];
  for (const [folder, group] of [...byFolder].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
    const journalPages = sorted.map((page, i) => {
      const { variant, ownership } = visibility(page, opts);
      return {
        _id: pageId(opts.vaultId, page.path),
        name: page.title,
        type: "text",
        sort: (i + 1) * 100,
        title: { show: false, level: 1 },
        text: { format: 1, content: `@vaults/${variant}/${page.path.replace(/\.md$/i, "")}.body.html` },
        ownership: { default: ownership },
      };
    });

    // A player needs to see the entry before per-page ownership can matter, so
    // an entry holding anything visible is observable and hides the rest.
    const anyVisible = journalPages.some((p) => p.ownership.default === OBSERVER);
    entries.push({
      id: entryId(opts.vaultId, folder),
      type: "JournalEntry",
      pack,
      ...(graftFolder(folderOf(folder)) ? { folder: folderOf(folder) } : {}),
      patch: {
        name: folder ? folder.split("/").pop()! : "Home",
        ownership: { default: anyVisible ? OBSERVER : NONE },
        pages: journalPages,
      },
    });
  }
  return entries;
}

/**
 * A page's `foundry.base` becomes a graft of that document.
 *
 * This is the whole of what `instance.mjs` did at runtime — clone a compendium
 * document, apply the page's overrides, keep a deterministic id — expressed as
 * the thing graft already builds. A base that names a UUID is a source; a page
 * with only `foundry.data` carries its own content and has none.
 */
export function documentEntries(pages: Page[], opts: GraftOptions): { entries: GraftEntry[]; warnings: string[] } {
  const entries: GraftEntry[] = [];
  const warnings: string[] = [];

  for (const page of pages) {
    const spec = page.foundry;
    if (!spec?.base) continue;

    const type = documentTypeOf(spec.base);
    if (!type) {
      warnings.push(`${page.path}: cannot tell what kind of document "${spec.base}" is`);
      continue;
    }
    const pack = opts.packs[type];
    if (!pack) {
      warnings.push(`${page.path}: no pack declared for ${type}`);
      continue;
    }

    const { ownership } = visibility(page, opts);
    const patch: Record<string, unknown> = {
      name: page.title,
      ...(spec.data ?? {}),
      ownership: { default: ownership },
    };
    entries.push({
      id: instanceId(opts.vaultId, page.path),
      type,
      pack,
      ...(graftFolder(folderOf(page.path)) ? { folder: folderOf(page.path) } : {}),
      ...(spec.base.startsWith("Compendium.") ? { source: spec.base } : {}),
      patch,
    });
  }
  return { entries, warnings };
}

/**
 * The document type a `foundry.base` names.
 *
 * A compendium UUID carries it (`Compendium.<mod>.<pack>.<Type>.<id>`); a bare
 * type name is a page inventing its own content.
 */
export function documentTypeOf(base: string): string | null {
  if (base.startsWith("Compendium.")) {
    const parts = base.split(".");
    return parts.length >= 5 ? parts[parts.length - 2]! : null;
  }
  return /^[A-Z][A-Za-z]+$/.test(base) ? base : null;
}

/** Everything a vault contributes, in the order graft will read it. */
export function buildGrafts(pages: Page[], opts: GraftOptions): { file: GraftsFile; warnings: string[] } {
  const docs = documentEntries(pages, opts);
  return {
    file: { format: 1, version: opts.version, entries: [...journalEntries(pages, opts), ...docs.entries] },
    warnings: docs.warnings,
  };
}
