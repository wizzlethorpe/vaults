// Compile a vault into a grafts.json: the entry list graft builds from.
// Nothing here touches Foundry or the filesystem, so the whole mapping is
// testable on its own.

import { createHash } from "node:crypto";

import { DOC_TYPES, canonicalType } from "./foundry-types.js";
import { rewriteVaultRefs } from "./foundry-html.js";
import { defaultsFor, resolvePageRefs } from "./foundry-defaults.js";
import { asAdventure } from "./foundry-adventure.js";
import { mergeDefaults } from "./frontmatter-defaults.js";
import type { LinkIndex, LinkTarget } from "./foundry-html.js";

/** One graft entry. `source` absent means the patch *is* the document. */
export interface GraftEntry {
  id: string;
  type: string;
  pack: string;
  folder?: string;
  /** A UUID, or several to try in order. */
  source?: string | string[];
  patch: Record<string, unknown>;
}

export interface GraftsFile {
  format: 1;
  /**
   * The Foundry version these documents were authored at, when the vault says.
   * Recorded so a reader can see what a build was made from; the value that
   * matters is the one stamped on each document's own `_stats`.
   */
  coreVersion?: string;
  /**
   * Content hash per `"<variant>/<path>"`, for every asset this file can
   * reach. What lets a reader tell a file it already downloaded from one that
   * only shares its name: nothing else about a reference changes when the
   * bytes behind it do.
   */
  assets?: Record<string, string>;
  /**
   * Hash of everything a build of this variant fetches — see contentHash().
   * Also written to the variant's version.json, so the module can ask "is
   * there newer content?" without downloading this whole file.
   */
  contentHash: string;
  entries: GraftEntry[];
}

/**
 * The one definition of "the content changed".
 *
 * A build consumes three things, and each is hashed by value: the entries
 * (patches, sidecars, ids), every page body the entries reference, and the
 * bytes of every asset those bodies and entries reference (the assets map
 * already carries a content hash per file). That is the provider's whole
 * fixed point, so anything it would fetch differently moves this.
 */
export function contentHash(
  entries: GraftEntry[], assets: Record<string, string>, bodies: ReadonlyMap<string, string>,
): string {
  const sortedBodies = [...bodies].sort(([a], [b]) => a.localeCompare(b));
  return createHash("md5")
    .update(JSON.stringify({ entries, assets, bodies: sortedBodies }))
    .digest("hex").slice(0, 16);
}

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
  patch: Record<string, unknown>, type: string, page: Page, variant: string, system: string,
): Record<string, unknown> {
  // `embed: false` opts the page's prose out of the document's description.
  // An unsatisfied `@page/body` reference takes its key with it, so nothing
  // else is needed to suppress the default.
  const body = page.foundry?.embed === false
    ? undefined
    : `@vaults/${variant}/${page.path.replace(/\.md$/i, "")}.foundry.html`;
  const out = structuredClone(patch);
  // Most specific first: each merge fills only what is still unsaid, so the
  // earlier a layer is applied the more it wins.
  const layers = [page.sidecar, ...defaultsFor(type, system).reverse()];
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
function pinnedId(patch: Record<string, unknown> | undefined, warnings: string[], path: string): string | null {
  const id = patch?.["_id"];
  if (id === undefined || id === null) return null;
  const pinned = pinnedIdOf(patch);
  if (pinned) return pinned;
  warnings.push(`${path}: foundry.patch._id must be 16 letters or digits, got ${JSON.stringify(id)}; using the derived id`);
  return null;
}

/** `patch._id` when it is a well-formed pin, with no warning: the emitter warns once. */
function pinnedIdOf(patch: Record<string, unknown> | undefined): string | null {
  const id = patch?.["_id"];
  return typeof id === "string" && /^[A-Za-z0-9]{16}$/.test(id) ? id : null;
}

/** Every usable UUID in a `foundry.source`, which may be a list, in order. */
export function basesOf(base: unknown): string[] {
  if (typeof base === "string") return base.trim() ? [base.trim()] : [];
  if (Array.isArray(base)) {
    return base.filter((b): b is string => typeof b === "string" && !!b.trim()).map((b) => b.trim());
  }
  return [];
}

/** The first usable UUID, which decides the document type and the pack. */
export const firstBase = (base: unknown): string | null => basesOf(base)[0] ?? null;

export interface GraftOptions {
  /** Also the module id, which is what a Compendium UUID names. */
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
   * The role whose file this is. Bodies are never referenced above it, since
   * the reader holding this file could not fetch them: each variant has to be
   * buildable by whoever is served it.
   */
  buildRole: string;
  /** Pack name per document type, e.g. `{ JournalEntry: "marlo-journals" }`. */
  packs: Record<string, string>;
  /** Foundry version the vault's document data was authored at, e.g. "14". */
  coreVersion?: string;
  /** Game system the vault targets, for system-specific enrichers. */
  system?: string;
  /** How the vault is delivered: browsable packs, or one Adventure. */
  packaging?: "compendium" | "adventure";
  /** Display name, used for the Adventure itself. */
  title?: string;
  /** Content hash per `"<variant>/<path>"`; see `GraftsFile.assets`. */
  assets?: Record<string, string>;
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
 * Whether players may see a page's document, and whose body it carries.
 *
 * The body is always the build role's own rendering — the reader of this file
 * cannot fetch any other. A player-visible page's body carries the player
 * render alongside it, inside the file (see dualVariantBody).
 */
export function visibility(page: Page, opts: GraftOptions): { variant: string; ownership: number } {
  const rank = (role: string) => opts.roles.indexOf(role);
  const ceiling = rank(opts.playerRole);
  const observable = ceiling >= 0 && rank(page.role) >= 0 && rank(page.role) <= ceiling;
  return { variant: opts.buildRole, ownership: observable ? OBSERVER : NONE };
}


/**
 * Resolve map-note references to journal ids, in place.
 *
 * A note names its target by page path — `"entryId": "@vault/Places/Arlanton"`
 * — because document ids are this build's to assign, and the ids an export
 * carries point at whatever world it came from. Both ids fill from the one
 * path; a stated pageId is replaced.
 */
export function resolveNoteRefs(
  patch: Record<string, unknown> | undefined, opts: GraftOptions,
  known?: Set<string>, warnings?: string[], path?: string,
): void {
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const v of value) walk(v); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const ref = node["entryId"];
    if (typeof ref === "string" && ref.startsWith("@vault/")) {
      const target = ref.slice("@vault/".length).replace(/^\/+/, "");
      const page = /\.md$/i.test(target) ? target : `${target}.md`;
      if (known && !known.has(page)) {
        warnings?.push(`${path}: a map note points at "${target}", which is not a page in this build`);
      }
      node["entryId"] = entryId(opts.vaultId, folderOf(page));
      node["pageId"] = pageId(opts.vaultId, page);
    }
    for (const v of Object.values(node)) walk(v);
  };
  if (patch) walk(patch);
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
    if (page.foundry?.sync === false || page.foundry?.journal === false) continue;
    const folder = folderOf(page.path);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder)!.push(page);
  }

  const entries: GraftEntry[] = [];
  for (const [folder, group] of [...byFolder].sort(([a], [b]) => a.localeCompare(b))) {
    // The folder's index page reads first; the rest alphabetically.
    const isIndex = (p: Page) => /(^|\/)index\.md$/i.test(p.path);
    const sorted = [...group].sort((a, b) =>
      Number(isIndex(b)) - Number(isIndex(a)) || a.path.localeCompare(b.path));
    const journalPages = sorted.map((page, i) => {
      const { variant, ownership } = visibility(page, opts);
      return {
        _id: pageId(opts.vaultId, page.path),
        name: page.title,
        type: "text",
        sort: (i + 1) * 100,
        title: { show: false, level: 1 },
        text: { format: 1, content: `@vaults/${variant}/${page.path.replace(/\.md$/i, "")}.foundry.html` },
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
 * A page's `foundry.source` becomes a graft of that document.
 *
 * This is the whole of what `instance.mjs` did at runtime — clone a compendium
 * document, apply the page's overrides, keep a deterministic id — expressed as
 * the thing graft already builds. A base that names a UUID is a source; a page
 * with only `foundry.patch` carries its own content and has none.
 */
export function documentEntries(pages: Page[], opts: GraftOptions): { entries: GraftEntry[]; warnings: string[] } {
  const entries: GraftEntry[] = [];
  const warnings: string[] = [];
  const paths = new Set(pages.map((p) => p.path));

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
    const pack = opts.packs[type];
    if (!pack) {
      warnings.push(`${page.path}: no pack declared for ${type}`);
      continue;
    }

    const { variant, ownership } = visibility(page, opts);
    const subtype = subtypeOf(base);
    resolveNoteRefs(spec.patch, opts, paths, warnings, page.path);
    resolveNoteRefs(page.sidecar, opts, paths, warnings, page.path);
    const patch: Record<string, unknown> = rewriteVaultRefs({
      name: page.title,
      ...(subtype ? { type: subtype } : {}),
      ...defaulted(spec.patch ?? {}, type, page, variant, opts.system ?? "dnd5e"),
      // Over the patch, not under it: ownership is role gating, and a page that
      // could overrule its own would be a page that could publish itself.
      ownership: { default: ownership },
    }, variant);
    const folder = typeof spec.folder === "string" && spec.folder.trim()
      ? spec.folder.trim().replace(/^\/+|\/+$/g, "")
      : folderOf(page.path);
    entries.push({
      id: pinnedId(spec.patch, warnings, page.path) ?? instanceId(opts.vaultId, page.path),
      type,
      pack,
      ...(graftFolder(folder) ? { folder } : {}),
      // A list travels whole: graft tries each in order and takes the first
      // that resolves, so a page can prefer better content without demanding
      // the reader own it.
      ...(base.startsWith("Compendium.")
        ? { source: bases.length > 1 ? bases : base }
        : {}),
      patch,
    });
  }
  return { entries, warnings };
}

/**
 * The document type a `foundry.source` names.
 *
 * A compendium UUID carries it (`Compendium.<mod>.<pack>.<Type>.<id>`); a bare
 * type name is a page inventing its own content.
 */
export function documentTypeOf(base: string): string | null {
  if (base.startsWith("Compendium.")) {
    const parts = base.split(".");
    return parts.length >= 5 ? parts[parts.length - 2]! : null;
  }
  return canonicalType(base.split(":")[0]);
}

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

/** Everything a vault contributes, in the order graft will read it. */
/**
 * Where a link to each page should land.
 *
 * Built from the same ids the entries carry, in the same pass, because a link
 * index derived separately is one that can disagree with what was written.
 */
export function linkIndex(pages: Page[], opts: GraftOptions): LinkIndex {
  const targets = new Map<string, LinkTarget>();
  for (const page of pages) {
    if (page.foundry?.sync === false) continue;
    const target: LinkTarget = {};
    const base = firstBase(page.foundry?.source);
    const type = base ? documentTypeOf(base) : null;
    const pack = type ? opts.packs[type] : undefined;
    if (type && pack) {
      target.doc = {
        type, pack,
        id: pinnedIdOf(page.foundry?.patch) ?? instanceId(opts.vaultId, page.path),
      };
    }
    if (page.foundry?.journal !== false) {
      target.entry = entryId(opts.vaultId, folderOf(page.path));
      target.page = pageId(opts.vaultId, page.path);
    }
    if (target.doc || target.page) targets.set(page.path, target);
  }
  return {
    targets,
    moduleId: opts.vaultId,
    journalPack: opts.packs["JournalEntry"] ?? "",
    packaging: opts.packaging ?? "compendium",
  };
}

/**
 * Stamp `_stats.coreVersion`, which Foundry requires and will not supply.
 *
 * A document without it fails strict validation outright ("coreVersion: may not
 * be undefined"), so Foundry's import errors and graft falls back to
 * constructing the document loosely. What comes out is not the document: a
 * Scene loses every level it had and arrives with one blank default, and
 * nothing on the way through says so.
 *
 * The value is what the data *is*, not what the reader is running. Foundry
 * migrates anything older than the running version, which is the correct thing
 * to do and is why claiming to be current would be the wrong fix — it would
 * skip a migration that genuinely old data needs. A sidecar exported with its
 * own `_stats` keeps it; this only fills the gap.
 *
 * An entry with a source is left alone for the same reason: the document is
 * mostly the compendium's, and the reader's copy of that already records the
 * generation it was written for.
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
): { file: GraftsFile; warnings: string[]; links: LinkIndex } {
  const docs = documentEntries(pages, opts);
  // Stamped before folding: inside an Adventure the documents that need a
  // `coreVersion` are nested, and nothing reaches them afterwards.
  const typed = stampCoreVersion(
    [...journalEntries(pages, opts), ...docs.entries], opts.coreVersion ?? "");
  const shaped = opts.packaging === "adventure"
    ? asAdventure(typed, {
      id: instanceId(opts.vaultId, "\u0000adventure"),
      pack: opts.packs["Adventure"] ?? `${opts.vaultId}-adventure`,
      name: opts.title ?? opts.vaultId,
      folderId: (type, path) => det("folder", `${opts.vaultId}:${type}:${path}`),
    })
    : { entries: typed, warnings: [] };
  const entries = stampCoreVersion(shaped.entries, opts.coreVersion ?? "");
  const assets = opts.assets && Object.keys(opts.assets).length ? opts.assets : undefined;
  return {
    file: {
      format: 1,
      ...(opts.coreVersion ? { coreVersion: opts.coreVersion } : {}),
      ...(assets ? { assets } : {}),
      // Finished by the caller once the bodies exist; see contentHash().
      contentHash: "",
      entries,
    },
    warnings: [...docs.warnings, ...shaped.warnings],
    links: linkIndex(pages, opts),
  };
}

// ── the module a vault ships ────────────────────────────────────────────────
//
// Generated once and then inert. It declares packs and dependencies and points
// at the vault; it holds no logic, so pushing content never means reinstalling
// it. That is the whole reason the provider lives in a shared module instead.

/** One pack per document type, declared up front. */
export const PACK_SUFFIX: Record<string, string> = Object.fromEntries(
  Object.entries(DOC_TYPES).map(([type, info]) => [type, info.packSuffix]),
);

export function packsFor(moduleId: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PACK_SUFFIX).map(([type, suffix]) => [type, `${moduleId}-${suffix}`]),
  );
}

/**
 * The pack types a vault's module declares.
 *
 * Compendium packaging declares them all, used or not: packs are read when the
 * server starts, so a vault that later gains its first Scene would otherwise
 * need the module reinstalled and Foundry restarted before it could build.
 *
 * Adventure packaging needs exactly one, permanently. Everything the vault
 * holds goes inside the Adventure, so gaining a new document type adds nothing
 * to declare — and seven empty packs beside it are seven things a reader opens
 * once to find out they are empty.
 */
export function packTypesFor(packaging: "compendium" | "adventure"): string[] {
  return packaging === "adventure" ? ["Adventure"] : Object.keys(PACK_SUFFIX).filter((t) => t !== "Adventure");
}

export interface ManifestOptions {
  moduleId: string;
  title: string;
  vaultUrl: string;
  /** The game system whose Actor and Item packs this vault targets. */
  systemId?: string;
  /** Extra manifest keys from `foundry.module` in settings.md. */
  extra?: Record<string, unknown>;
  /** How the vault is delivered, which decides what packs it declares. */
  packaging?: "compendium" | "adventure";
}

/**
 * The `module.json` a vault serves for itself.
 *
 * Every pack type is declared whether the vault uses it or not: packs are read
 * when the server starts, so a vault that later gains its first Scene would
 * otherwise need the module reinstalled and the server restarted before it
 * could build. Declaring them all keeps the module genuinely permanent.
 */
const label = (suffix: string) => `${suffix[0]!.toUpperCase()}${suffix.slice(1)}`;

export function moduleManifest(opts: ManifestOptions): Record<string, unknown> {
  const url = opts.vaultUrl.replace(/\/+$/, "");
  return {
    id: opts.moduleId,
    title: opts.title,
    description: `Content from ${url}, built on your machine from what you are entitled to read.`,
    compatibility: { minimum: "14", verified: "14" },
    url,
    manifest: `${url}/_foundry/module.json`,
    download: `${url}/_foundry/module.zip`,
    packs: packTypesFor(opts.packaging ?? "compendium").map((type) => ({
      name: `${opts.moduleId}-${PACK_SUFFIX[type]!}`,
      label: `${opts.title}: ${label(PACK_SUFFIX[type]!)}`,
      path: `packs/${opts.moduleId}-${PACK_SUFFIX[type]!}`,
      type,
      // Never player-browsable. A reader sees vault content because the GM
      // imported it, and the entry itself says whether they may.
      ownership: { PLAYER: "NONE", ASSISTANT: "OWNER" },
      // The Adventure pack needs a system as much as the Actor pack does:
      // Adventure.fromSource empties actors, items and their folders out of
      // any adventure read from a systemless pack.
      ...(type === "Actor" || type === "Item" || type === "Adventure"
        ? { system: opts.systemId ?? "dnd5e" } : {}),
    })),
    packFolders: [{
      name: opts.title, sorting: "m",
      packs: packTypesFor(opts.packaging ?? "compendium").map((t) => `${opts.moduleId}-${PACK_SUFFIX[t]!}`),
    }],
    relationships: {
      requires: [
        { id: "graft", type: "module" },
        { id: "vaults", type: "module" },
      ],
    },
    // How graft finds anything here. It reads a module's `flags.graft.entries`
    // for the files to load; without this the module is a set of empty packs
    // and a manifest, and nothing ever asks the vault for its contents.
    flags: { graft: { entries: ["grafts.json"] } },
    ...(opts.extra ?? {}),
  };
}

/** The one-line grafts.json the module ships: a pointer, not a list. */
export function moduleGrafts(vaultUrl: string, gated: boolean): unknown[] {
  // `gated` is not a hint the provider could work out for itself. A single-role
  // deploy collapses its one variant to the site root and ships no Pages
  // Functions, so `/_batch` is not there and a reference's variant segment is
  // not a directory. A gated deploy is the opposite on both counts. Probing for
  // the difference means reading a 404 as "public", which is also what a
  // misconfigured deploy looks like.
  return [{ vault: vaultUrl.replace(/\/+$/, ""), gated }];
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
