// Compile a vault into a grafts.json: the entry list graft builds from.
// Nothing here touches Foundry or the filesystem, so the whole mapping is
// testable on its own.

import { createHash } from "node:crypto";

import { mergeDefaults, type TokenDownload } from "@wizzlethorpe/vaults/addon";
import { canonicalType } from "./foundry-types.js";
import { rewriteVaultRefs } from "./foundry-html.js";
import { defaultsFor, resolvePageRefs } from "./foundry-defaults.js";
import type { LinkIndex, LinkTarget } from "./foundry-html.js";
import { GRAFTS_PATH } from "./handlers/foundry-install.js";

/** One graft entry. `source` absent means the patch *is* the document. */
export interface GraftEntry {
  id: string;
  type: string;
  folder?: string;
  /** A UUID, a sibling's bare id, or several to try in order. */
  source?: string | string[];
  patch: Record<string, unknown>;
}

/** One file for graft's `http` asset handler to place. */
export interface AssetFile {
  /** Where to fetch it: its own URL, or a zip member first and that URL after. */
  source: string | string[];
  /** Where it lands in the reader's Foundry data directory. */
  destination: string;
  size: number;
}

export interface GraftsFile {
  format: 4;
  entries: GraftEntry[];
  /**
   * Files that have to be on disk before anything builds. Keyed by handler;
   * a vault only ever uses `http`, since everything it serves is a URL.
   */
  assets?: { http: { auth?: Record<string, string>; files: AssetFile[] } };
}

export const GRAFTS_DOWNLOAD: TokenDownload = {
  path: GRAFTS_PATH,
  tokens: ["assets", "http", "auth"],
  // Long enough to survive downloading at a desk and building at the table.
  maxAge: 60 * 60 * 2,
};

const DOCUMENT_ID = /^[a-zA-Z0-9]{16}$/;

/** Just enough of a page to place it. */
export interface Page {
  path: string;                    // "Characters/Nobles/Marlo.md"
  title: string;
  role: string;
  /**
   * The `foundry:` frontmatter block, if any. `source` may be a priority list.
   * `sync: false` keeps the page out of Foundry entirely; `journal: false`
   * makes its document but no journal page; `embed: false` keeps the page's
   * prose out of the document's description; `folder` overrides where the
   * document files, independent of where the page lives.
   */
  foundry?: {
    source?: unknown; patch?: Record<string, unknown>;
    sync?: boolean; journal?: boolean; embed?: boolean; folder?: string;
  } | null;
  /** The page's representative image, as a served URL ("/attachments/x.webp"). */
  image?: string | null;
  /**
   * The page's `foundry.patch_json`, already read. A layer of its own, weaker
   * than the inline patch: an exported statblock carries whatever Foundry had,
   * which is often a system placeholder rather than anyone's choice.
   */
  sidecar?: Record<string, unknown>;
}

/**
 * The page's patch with the defaults for its type filled in underneath.
 *
 * Least specific first, so a more specific default beats a broader one and the
 * page beats both. `mergeDefaults` never reaches past a value that is already
 * there, which is what makes "the page wins" true at every depth — including
 * when the value it states is `null`.
 */
function defaulted(
  patch: Record<string, unknown>, type: string, page: Page, opts: GraftOptions,
): Record<string, unknown> {
  // `embed: false` opts the page's prose out of the document's description.
  // An unsatisfied `@page/body` reference takes its key with it, so nothing
  // else is needed to suppress the default.
  const body = page.foundry?.embed === false ? undefined : () => opts.body(page);
  const out = structuredClone(patch);
  // Most specific first: each merge fills only what is still unsaid, so the
  // earlier a layer is applied the more it wins.
  const layers = [page.sidecar, ...defaultsFor(type, opts.system ?? "dnd5e").reverse()];
  for (const layer of layers) {
    if (!layer) continue;
    const resolved = resolvePageRefs(layer, { image: page.image, body });
    if (resolved) mergeDefaults(out, resolved);
  }
  // After the merge, not before: an exported sidecar carries the `_id` it had
  // in the world it came from, and it would otherwise refill the key.
  delete out["_id"];
  return out;
}

/**
 * A document id the page pinned for itself, as `patch._id`.
 *
 * Otherwise the id comes from the page's path, which is stable until the page
 * moves — and a move then orphans everything the reader had built under the old
 * id. Pinning is how a page survives being renamed, and it belongs in the patch
 * because `_id` is a field of the document, not a fact about the vault.
 *
 * Foundry ids are exactly 16 characters of [A-Za-z0-9]. A malformed one is
 * reported and ignored rather than passed on: Foundry would refuse the document
 * and the page would simply not appear.
 */
function pinnedId(
  patch: Record<string, unknown> | undefined, report?: { warnings: string[]; path: string },
): string | null {
  const id = patch?.["_id"];
  if (typeof id === "string" && DOCUMENT_ID.test(id)) return id;
  if (id !== undefined && id !== null) {
    report?.warnings.push(`${report.path}: foundry.patch._id must be 16 letters or digits, got ${JSON.stringify(id)}; using the derived id`);
  }
  return null;
}

/** Every usable UUID in a `foundry.source`, which may be a list, in order. */
export function basesOf(base: unknown): string[] {
  if (typeof base === "string") return base.trim() ? [base.trim()] : [];
  if (Array.isArray(base)) {
    return base.filter((b): b is string => typeof b === "string" && !!b.trim()).map((b) => b.trim());
  }
  return [];
}

/** The first usable UUID, which decides the document type. */
export const firstBase = (base: unknown): string | null => basesOf(base)[0] ?? null;

export interface GraftOptions {
  /** Seeds every deterministic id and names the directory the assets land in. */
  vaultId: string;
  /** Role names, least privileged first. The last is what the GM builds as. */
  roles: string[];
  /**
   * The highest role players may read. Empty means none of it: a vault that
   * has not opted in publishes nothing to the table, which is the only safe
   * reading of an unset setting.
   */
  playerRole: string;
  /**
   * Where this vault's files land in the reader's data directory, e.g.
   * `"vaults/marlo"`. Media in a body and `@vault/` refs in a patch name a
   * path under it, and the `assets` block sends the same path to the handler.
   */
  assetBase: string;
  /**
   * Filled with the vault-relative path of every asset a patch names, so the
   * build ships those files and no others. Bodies add to the same set.
   */
  namedAssets: Set<string>;
  /** A page's article as a journal body. Called only for a page whose body an entry carries. */
  body: (page: Page) => string;
  /** Foundry version the vault's document data was authored at, e.g. "14". */
  coreVersion?: string;
  /** Game system the vault targets, for system-specific enrichers. */
  system?: string;
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
export const itemId = (vaultId: string, path: string, key: string) =>
  det("item", `${vaultId}:${path}:${key}`);

/**
 * Every `uuid` item in the patch's own `items` as graft's `{ _id, source, patch }`,
 * since Foundry rejects an item written as `{ uuid }`. Nothing deeper: a `uuid` in an
 * advancement's grant list is offered, not placed. Keyed by uuid, so reordering moves nothing.
 */
export function withItemIds(
  patch: Record<string, unknown>, vaultId: string, path: string,
): Record<string, unknown> {
  const items = patch["items"];
  if (!Array.isArray(items)) return patch;
  const seen = new Map<string, number>();
  return {
    ...patch,
    items: items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const { uuid, _id, ...rest } = item as Record<string, unknown>;
      if (typeof uuid !== "string") return item;
      const n = seen.get(uuid) ?? 0;
      seen.set(uuid, n + 1);
      return {
        _id: typeof _id === "string" ? _id : itemId(vaultId, path, `${uuid}:${n}`),
        source: uuid,
        ...(Object.keys(rest).length > 0 ? { patch: rest } : {}),
      };
    }),
  };
}

/**
 * Foundry's embedded collections, by the type of document that holds them.
 * Taken from the document schemas: no property of a patch distinguishes one
 * from an ordinary array of objects, and `Card.faces` is such an array.
 */
const EMBEDDED: Record<string, string[]> = {
  Actor: ["items", "effects"],
  Cards: ["cards"],
  Combat: ["combatants", "groups"],
  Item: ["effects"],
  JournalEntry: ["pages", "categories"],
  Playlist: ["sounds"],
  RollTable: ["results"],
  Scene: ["drawings", "levels", "lights", "notes", "regions", "sounds", "tiles", "tokens"],
};

/**
 * An `_id` for every embedded document in the patch that lacks one.
 *
 * Foundry mints a random one on each build, so the document never matches what
 * the last build wrote and graft rewrites it forever. Graft also replaces a
 * collection outright unless every member carries an `_id`. Keyed by position,
 * so an id is stable until the author reorders the collection.
 */
export function withEmbeddedIds(
  patch: Record<string, unknown>, type: string, vaultId: string, path: string,
): Record<string, unknown> {
  const out = { ...patch };
  for (const field of EMBEDDED[type] ?? []) {
    const members = out[field];
    if (!Array.isArray(members)) continue;
    out[field] = members.map((member, i) => {
      if (!member || typeof member !== "object" || Array.isArray(member)) return member;
      const held = (member as Record<string, unknown>)["_id"];
      return typeof held === "string"
        ? member
        : { _id: itemId(vaultId, path, `${field}:${i}`), ...member };
    });
  }
  return out;
}

export const folderOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

/** Whether players may see a page's document. An unknown role fails closed. */
export function observable(page: Page, opts: GraftOptions): boolean {
  const rank = (role: string) => opts.roles.indexOf(role);
  const ceiling = rank(opts.playerRole);
  return ceiling >= 0 && rank(page.role) >= 0 && rank(page.role) <= ceiling;
}

/** The roles players may not read, lowercased the way a callout's type names one. */
export function secretRoles(opts: GraftOptions): Set<string> {
  return new Set(opts.roles.slice(opts.roles.indexOf(opts.playerRole) + 1).map((r) => r.toLowerCase()));
}


/** What a page-path reference can land on in this build. */
interface VaultIdTargets {
  /** Page path to the id of the document it makes. */
  docs: Map<string, string>;
  /** Pages that make a journal page. */
  journals: Set<string>;
}

/**
 * Resolve page-path references inside a patch to this build's ids.
 *
 * A map note names its page — `"entryId": "@vault/Places/Arlanton"` — and a
 * token names its actor's page — `"actorId": "@vault/Actors/Macy Arla"` —
 * because document ids are this build's to assign, and the ids an export
 * carries point at whatever world it came from. Returns a new value: the
 * patch is the page's own frontmatter, shared by every variant's build.
 */
export function resolveVaultIds<T>(
  value: T, opts: GraftOptions, targets: VaultIdTargets, warnings: string[], path: string,
): T {
  const pageOf = (ref: string): string => {
    const target = ref.slice("@vault/".length).replace(/^\/+/, "");
    return /\.md$/i.test(target) ? target : `${target}.md`;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x);
    const entry = out["entryId"];
    if (typeof entry === "string" && entry.startsWith("@vault/")) {
      const page = pageOf(entry);
      if (!targets.journals.has(page)) {
        warnings.push(`${path}: a map note points at "${page}", which makes no journal page in this build`);
      }
      out["entryId"] = entryId(opts.vaultId, folderOf(page));
      out["pageId"] = pageId(opts.vaultId, page);
    }
    const actor = out["actorId"];
    if (typeof actor === "string" && actor.startsWith("@vault/")) {
      const page = pageOf(actor);
      const id = targets.docs.get(page);
      if (!id) warnings.push(`${path}: a token points at "${page}", which makes no document in this build`);
      out["actorId"] = id ?? instanceId(opts.vaultId, page);
    }
    return out;
  };
  return walk(value) as T;
}

/** Which of these pages make a document, and which a journal page. */
function vaultIdTargets(pages: Page[], opts: GraftOptions): VaultIdTargets {
  const docs = new Map<string, string>();
  const journals = new Set<string>();
  for (const p of pages) {
    if (p.foundry?.sync === false) continue;
    if (p.foundry?.journal !== false) journals.add(p.path);
    const base = firstBase(p.foundry?.source);
    const type = base ? documentTypeOf(base) : null;
    if (type) docs.set(p.path, pinnedId(p.foundry?.patch) ?? instanceId(opts.vaultId, p.path));
  }
  return { docs, journals };
}

/** Where a page's document files: its foundry.folder override, or its own directory. */
export function documentFolder(page: { path: string; foundry?: { folder?: string } | null }): string {
  const override = page.foundry?.folder;
  return typeof override === "string" && override.trim()
    ? override.trim().replace(/^\/+|\/+$/g, "")
    : folderOf(page.path);
}

/** `"Characters/Nobles/Marlo.md"` to `"Characters/Nobles"`, or undefined at the root. */
const graftFolder = (folder: string): string | undefined => folder || undefined;

/**
 * One JournalEntry per directory, every `.md` in it an embedded page.
 * A directory of notes reads as one journal a GM can page through, rather than
 * fifty entries in a list.
 */
export function journalEntries(pages: Page[], opts: GraftOptions): GraftEntry[] {
  const byFolder = new Map<string, Page[]>();
  for (const page of pages) {
    if (page.foundry?.sync === false || page.foundry?.journal === false) continue;
    const folder = folderOf(page.path);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder)!.push(page);
  }

  // Where a folder's own entry files. Inside its own folder when that folder
  // exists in Foundry, which is when something sits below it; otherwise beside
  // its siblings, so a leaf does not get a folder holding one entry.
  const dirs = [...byFolder.keys()];
  const home = (folder: string) =>
    (folder && dirs.some((d) => d.startsWith(`${folder}/`)) ? folder : folderOf(folder));

  const entries: GraftEntry[] = [];
  for (const [folder, group] of [...byFolder].sort(([a], [b]) => a.localeCompare(b))) {
    // The folder's index page reads first; the rest alphabetically.
    const isIndex = (p: Page) => /(^|\/)index\.md$/i.test(p.path);
    const sorted = [...group].sort((a, b) =>
      Number(isIndex(b)) - Number(isIndex(a)) || a.path.localeCompare(b.path));
    const journalPages = sorted.map((page, i) => {
      const ownership = observable(page, opts) ? OBSERVER : NONE;
      return {
        _id: pageId(opts.vaultId, page.path),
        name: page.title,
        type: "text",
        sort: (i + 1) * 100,
        title: { show: false, level: 1 },
        text: { format: 1, content: opts.body(page) },
        ownership: { default: ownership },
      };
    });

    // A player needs to see the entry before per-page ownership can matter, so
    // an entry holding anything visible is observable and hides the rest.
    const anyVisible = journalPages.some((p) => p.ownership.default === OBSERVER);
    entries.push({
      id: entryId(opts.vaultId, folder),
      type: "JournalEntry",
      ...(graftFolder(home(folder)) ? { folder: home(folder) } : {}),
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
 * A page's `foundry.source` becomes a graft of that document.
 *
 * Clone a compendium document, apply the page's overrides, keep a
 * deterministic id: all of it expressed as the thing graft already builds. A
 * base that names a UUID is a source; a page with only `foundry.patch` carries
 * its own content and has none.
 */
export function documentEntries(pages: Page[], opts: GraftOptions): { entries: GraftEntry[]; warnings: string[] } {
  const entries: GraftEntry[] = [];
  const warnings: string[] = [];
  const sourcedBy = new Map<GraftEntry, { path: string; bases: string[] }>();
  const targets = vaultIdTargets(pages, opts);

  for (const page of pages) {
    const spec = page.foundry;
    if (!spec?.source || spec.sync === false) continue;

    const bases = basesOf(spec.source);
    const base = bases[0];
    if (!base) {
      warnings.push(`${page.path}: foundry.source should be a UUID or a list of them`);
      continue;
    }
    const type = documentTypeOf(base);
    if (!type) {
      warnings.push(`${page.path}: cannot tell what kind of document "${base}" is`);
      continue;
    }
    const subtype = subtypeOf(base);
    const resolved = {
      ...page,
      sidecar: resolveVaultIds(page.sidecar, opts, targets, warnings, page.path),
    };
    const patch: Record<string, unknown> = withEmbeddedIds(rewriteVaultRefs({
      name: page.title,
      ...(subtype ? { type: subtype } : {}),
      // GM-only unless the page's patch says otherwise. A page's role decides
      // who reads it on the wiki, not who sees the NPC it builds in the world.
      ownership: { default: NONE },
      ...defaulted(
        withItemIds(resolveVaultIds(spec.patch ?? {}, opts, targets, warnings, page.path),
          opts.vaultId, page.path),
        type, resolved, opts),
    }, opts.assetBase, opts.namedAssets), type, opts.vaultId, page.path);
    const folder = documentFolder(page);
    const id = pinnedId(spec.patch, { warnings, path: page.path }) ?? instanceId(opts.vaultId, page.path);
    if (entries.some((e) => e.id === id)) warnings.push(`${page.path}: foundry.patch._id "${id}" is also pinned by another page; graft refuses both`);
    entries.push({
      id,
      type,
      ...(graftFolder(folder) ? { folder } : {}),
      patch,
    });
    if (isSource(base)) sourcedBy.set(entries[entries.length - 1]!, { path: page.path, bases });
  }
  return { entries: placeSiblings(entries, sourcedBy, warnings), warnings };
}

/**
 * Set each sourced entry's `source`. A source naming something this build also
 * makes becomes a bare id, which graft resolves to wherever that entry landed.
 */
function placeSiblings(
  entries: GraftEntry[],
  sourcedBy: Map<GraftEntry, { path: string; bases: string[] }>,
  warnings: string[],
): GraftEntry[] {
  const built = new Map(entries.map((e) => [e.id, e]));
  // Three cases for a world UUID, and only `built` tells them apart: an id
  // this build assigns at the type it assigns becomes a bare id; the same id
  // at another type is an author mistake and is dropped, since resolving it
  // would hand back the wrong kind of document; anything else is content the
  // reader already has and is left exactly as written.
  const placeBase = (base: string): string[] => {
    if (!isWorldUuid(base)) return [base];
    const [type, id] = base.split(".") as [string, string];
    if (!built.has(id)) return [base];
    return built.get(id)!.type === type ? [id] : [];
  };
  return entries.map((entry) => {
    const named = sourcedBy.get(entry);
    if (!named) return entry;
    const placed = named.bases.flatMap(placeBase);
    if (placed.length === 0) {
      warnings.push(
        `${named.path}: grafts onto ${named.bases.map((b) => `"${b}"`).join(", ")}, which this build makes`
        + ` as a different document type. Check the type in the UUID matches the page it names.`,
      );
    }
    const source = placed.length > 0 ? placed : named.bases;
    return { ...entry, source: source.length > 1 ? source : source[0]! };
  });
}

/**
 * The document type a `foundry.source` names.
 *
 * A UUID carries it, compendium or world; a bare type name is a page inventing
 * its own content.
 */
export function documentTypeOf(base: string): string | null {
  const parts = base.split(".");
  // Canonicalised in every branch: Foundry resolves a Combat UUID happily and
  // a vault has nothing to build from one, so null is the honest answer.
  if (base.startsWith("Compendium.")) {
    return parts.length >= 5 ? canonicalType(parts[parts.length - 2]) : null;
  }
  if (isWorldUuid(base)) return canonicalType(parts[0]);
  return canonicalType(base.split(":")[0]);
}

/** `Actor.<id>`: a document in the reader's world, which is where a vault builds. */
function isWorldUuid(base: string): boolean {
  const parts = base.split(".");
  return parts.length === 2 && DOCUMENT_ID.test(parts[1] ?? "");
}

/**
 * Whether a base names an existing document rather than a type to invent.
 * `Actor:npc` invents one; either UUID form grafts onto one.
 */
const isSource = (base: string) => base.startsWith("Compendium.") || isWorldUuid(base);

/**
 * The system subtype in a bare base, if it names one.
 *
 * `Actor:npc` is a page inventing an NPC rather than grafting one: the
 * document type is the schema, the subtype is what kind of it this is, and
 * Foundry needs the second as a `type` field on the document itself.
 */
export function subtypeOf(base: string): string | null {
  if (base.startsWith("Compendium.")) return null;
  const [, subtype] = base.split(":");
  return subtype?.trim() || null;
}

/** Where a link to each page should land, from the same ids the entries carry. */
export function linkIndex(pages: Page[], opts: GraftOptions): LinkIndex {
  const targets = new Map<string, LinkTarget>();
  for (const page of pages) {
    if (page.foundry?.sync === false) continue;
    const target: LinkTarget = {};
    const base = firstBase(page.foundry?.source);
    const type = base ? documentTypeOf(base) : null;
    if (type) {
      target.doc = { type, id: pinnedId(page.foundry?.patch) ?? instanceId(opts.vaultId, page.path) };
    }
    if (page.foundry?.journal !== false) {
      target.entry = entryId(opts.vaultId, folderOf(page.path));
      target.page = pageId(opts.vaultId, page.path);
    }
    if (target.doc || target.page) targets.set(page.path, target);
  }
  return { targets };
}

/**
 * Stamp `_stats.coreVersion`: Foundry's import refuses a document without one
 * and graft then builds a degraded copy (a Scene loses its levels, silently).
 * A sidecar's own value survives; sourced entries are left alone, since the
 * reader's compendium copy records its own generation.
 */
function stampCoreVersion(entries: GraftEntry[], coreVersion: string): GraftEntry[] {
  if (!coreVersion) return entries;
  return entries.map((entry) => {
    if (entry.source) return entry;
    const stats = entry.patch["_stats"];
    const existing = stats && typeof stats === "object" && !Array.isArray(stats)
      ? stats as Record<string, unknown>
      : {};
    if (typeof existing["coreVersion"] === "string" && existing["coreVersion"]) return entry;
    return { ...entry, patch: { ...entry.patch, _stats: { ...existing, coreVersion } } };
  });
}

export function buildGrafts(
  pages: Page[], opts: GraftOptions,
): { file: GraftsFile; warnings: string[] } {
  const docs = documentEntries(pages, opts);
  const entries = stampCoreVersion(
    [...journalEntries(pages, opts), ...docs.entries], opts.coreVersion ?? "");
  // `assets` is added by the caller, which is what knows each file's size.
  return { file: { format: 4, entries }, warnings: docs.warnings };
}

/**
 * The folder-index pages the wiki synthesizes, as graft pages.
 *
 * The wiki gives every folder without an index.md a generated one, and its
 * body is on disk per variant; without these the journal has no page for a
 * folder to open at, and a note pointing at "Places/index" lands nowhere.
 * Each takes the lowest role among the folder's pages, so a folder with any
 * player-visible content gets a player-visible index.
 */
export function withFolderIndexes(pages: Page[], roles: string[]): Page[] {
  const rank = (r: string) => { const i = roles.indexOf(r); return i < 0 ? roles.length : i; };
  const real = new Set(pages.map((p) => p.path));
  const lowest = new Map<string, string>();
  for (const page of pages) {
    const parts = page.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      const held = lowest.get(folder);
      if (held === undefined || rank(page.role) < rank(held)) lowest.set(folder, page.role);
    }
  }
  const synthetic: Page[] = [];
  for (const [folder, role] of lowest) {
    const path = `${folder}/index.md`;
    if (real.has(path)) continue;
    synthetic.push({ path, title: folder.split("/").pop()!, role });
  }
  return [...pages, ...synthetic];
}

/** Pages a role may see, in the shape the emitter wants. */
export function pagesFrom(
  metas: Array<{
    path: string; title: string; role: string;
    frontmatter?: Record<string, unknown>; coverImage?: string;
  }>,
  visible: Set<string>,
  /**
   * Each page's `foundry.patch_json`, already read, by page path. That file is
   * where a Scene's walls and tiles actually live, so a page with one and no
   * entry here compiles to a name and nothing else. Reading it is the caller's
   * job because this file touches no disk.
   */
  patches?: Map<string, Record<string, unknown>>,
): Page[] {
  const pages: Page[] = [];
  for (const meta of metas) {
    if (!visible.has(meta.role)) continue;
    const fo = meta.frontmatter?.["foundry"];
    const block = fo && typeof fo === "object" && !Array.isArray(fo)
      ? { ...(fo as Record<string, unknown>) } as NonNullable<Page["foundry"]>
      : null;
    const sidecar = patches?.get(meta.path);
    pages.push({
      path: meta.path, title: meta.title, role: meta.role, foundry: block,
      ...(meta.coverImage ? { image: meta.coverImage } : {}),
      ...(sidecar ? { sidecar } : {}),
    });
  }
  return pages;
}
