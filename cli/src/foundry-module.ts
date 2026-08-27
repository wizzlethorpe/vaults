// Compile a vault into an installable Foundry VTT module.
//
// The Foundry *sync* module resolves a page's `foundry.base` against whatever
// the reader has installed, at sync time, in their world. A standalone module
// has no world to look in and no reader to ask, so it can only contain what
// this build can construct on its own: a blank document of a known type with
// `data_json` and `data` merged onto it.
//
// That is not a limitation to work around. Baking a cloned compendium document
// into a redistributable module is a licensing act — plainly so for a paid
// module's content, and not obviously fine even for the SRD — and the same is
// true of anything resolved out of a reader's Moulinette library, which is the
// entire premise of that feature. So the rule is: build what the vault owns,
// and say clearly what was left out.
//
// A `foundry.base` priority list already encodes the answer. `[Compendium.x,
// Scene]` means "use x if you have it, otherwise a blank Scene", and a
// standalone module *is* the otherwise case — so each list resolves to its
// last self-contained rung.
//
// Requires @foundryvtt/foundryvtt-cli, which is resolved lazily and is not a
// dependency of this package: it pulls classic-level, whose native build every
// user who never compiles a module would otherwise pay for.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import matter from "gray-matter";
import { canonicalFoundryType, loadDataJson } from "./foundry-meta.js";
import { loadConfig } from "./config.js";
import { applyFrontmatterDefaults, compileFrontmatterRules, type CompiledRule } from "./frontmatter-defaults.js";
import { buildFolders, renderBody, type LinkEntry } from "./foundry-module-render.js";
import {
  buildJournalEntries, journalEntryId, journalPageId, transformForModule,
  type JournalSource, type JournalTarget,
} from "./foundry-module-journal.js";
import { loadSettings } from "./settings.js";
import { scanVault } from "./scan.js";

const execFileAsync = promisify(execFile);

/**
 * Embedded collections that a LevelDB pack stores as their own keyed entries
 * rather than inline in the parent. Each member needs an `_id` and a `_key` of
 * the form `!<parent>.<collection>!<parentId>.<childId>`, and the Foundry CLI
 * fails with "Key cannot be null or undefined" when one is missing — which
 * names neither the document nor the field, so it is worth being explicit here.
 */
const EMBEDDED_FIELDS = new Set([
  "items", "effects", "results", "pages", "sounds", "cards",
  "drawings", "lights", "notes", "templates", "tiles", "tokens", "walls", "regions",
]);

/**
 * Where a rendered page body lands, per document type.
 *
 * Deliberately not the same table as the sync path's DESCRIPTION_FIELDS, which
 * is keyed by game system and covers only Actor and Item on dnd5e. The two
 * answer different questions: sync embeds a live JournalEntryPage and can
 * check `game.system.id` because it is running inside the world, while a
 * module inlines rendered HTML at build time, where no system is running and
 * a RollTable's description is a plain field every system shares.
 *
 * The consequence worth knowing: a synced RollTable has an empty description
 * and a module RollTable carries the page's prose. That is the sync path being
 * conservative rather than this one overreaching, but they do differ.
 */
const DESCRIPTION_PATH: Record<string, string> = {
  Item: "system.description.value",
  Actor: "system.details.biography.value",
  RollTable: "description",
  JournalEntry: "",
  Scene: "",
  Macro: "",
  Cards: "description",
  Playlist: "description",
};

/**
 * What Foundry stamps on a document, derived from the manifest rather than
 * hardcoded: the core version it was verified against, and the system it
 * requires. It is provenance metadata — Foundry shows it, nothing depends on
 * it — so guessing would be worse than reading what the author already
 * declared two fields away.
 */
function statsFor(manifest: Record<string, unknown>): Record<string, unknown> {
  const compat = (manifest["compatibility"] ?? {}) as Record<string, unknown>;
  const rel = (manifest["relationships"] ?? {}) as Record<string, unknown>;
  const requires = Array.isArray(rel["requires"]) ? rel["requires"] : [];
  const system = requires.find(
    (r) => r && typeof r === "object" && (r as Record<string, unknown>)["type"] === "system",
  ) as Record<string, unknown> | undefined;
  const systemCompat = (system?.["compatibility"] ?? {}) as Record<string, unknown>;
  return {
    coreVersion: compat["verified"] ?? compat["minimum"] ?? null,
    systemId: system?.["id"] ?? manifest["system"] ?? null,
    systemVersion: systemCompat["verified"] ?? systemCompat["minimum"] ?? null,
    createdTime: null, modifiedTime: null, lastModifiedBy: null,
    compendiumSource: null, duplicateSource: null, exportSource: null,
  };
}

/** One `flags.vaults.packs[]` entry: which folder compiles to which pack. */
export interface PackDecl {
  folder: string;
  name: string;
  label: string;
  type: string;
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const segs = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    if (cur[seg] == null || typeof cur[seg] !== "object") cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

/** What a pack of each type is called in Foundry's compendium list. */
const PACK_LABEL: Record<string, string> = {
  Actor: "Actors", Item: "Items", Scene: "Scenes", JournalEntry: "Journals",
  RollTable: "Roll Tables", Macro: "Macros", Cards: "Card Decks", Playlist: "Playlists",
};

/** LevelDB collection prefix per document type. */
const PACK_KEY: Record<string, string> = {
  Actor: "actors", Item: "items", Scene: "scenes", JournalEntry: "journal",
  RollTable: "tables", Macro: "macros", Cards: "cards", Playlist: "playlists",
};

export interface ModuleSkip {
  path: string;
  reason: string;
}

export interface ModuleResult {
  moduleId: string;
  version: string;
  documents: number;
  packs: string[];
  skipped: ModuleSkip[];
  manifestPath: string;
  zipPath: string;
}

/** Parse one `foundry.base` spec. Mirrors the module's own reading of it. */
function parseBase(spec: unknown): { blank: string; subtype?: string } | null {
  if (typeof spec !== "string" || !spec) return null;
  if (spec.startsWith("@moulinette/")) return null;
  if (spec.includes(".")) return null; // a UUID: not self-contained
  const [typeRaw, subtype] = spec.split(":");
  // The package's one copy of the type table, not a second: cli/src can import
  // across itself, and this repo has already paid for the version of this
  // question where five copies disagreed.
  const blank = canonicalFoundryType(typeRaw);
  return blank ? { blank, ...(subtype ? { subtype } : {}) } : null;
}

/** The last rung of a `foundry.base` a module can build on its own, or null. */
export function resolveSelfContainedBase(specs: string[]): { blank: string; subtype?: string } | null {
  const parsed = specs.map(parseBase).filter((p): p is { blank: string; subtype?: string } => p !== null);
  return parsed.length > 0 ? parsed[parsed.length - 1]! : null;
}

/**
 * A stable 16-char Foundry id ([A-Za-z0-9]) for a seed.
 *
 * base64 rather than hex, matching what the standalone compiler used: hex would
 * work, but changing the derivation would renumber every derived id in every
 * already-published pack, which reads as a content change to anyone diffing.
 */
function derivedId(seed: string): string {
  return createHash("sha1").update(seed).digest("base64")
    .replace(/[^A-Za-z0-9]/g, "").slice(0, 16).padEnd(16, "0");
}

function documentId(vaultId: string, pagePath: string): string {
  return derivedId(`vaults-module:${vaultId}:${pagePath}`);
}

/** Recursively rewrite `@vault/PATH` strings to a module-relative asset path. */
function rewriteAssetPaths(value: unknown, moduleId: string, seen: Set<string>): unknown {
  if (typeof value === "string") {
    if (value.startsWith("@vault/")) {
      const rel = value.slice("@vault/".length);
      seen.add(rel);
      return `modules/${moduleId}/assets/${rel}`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteAssetPaths(v, moduleId, seen));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteAssetPaths(v, moduleId, seen);
    return out;
  }
  return value;
}

/** Strip `@moulinette/` strings, dropping whatever contained them. */
export function stripMoulinette(value: unknown, found: Set<string>): unknown {
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const item of value) {
      if (typeof item === "string" && item.startsWith("@moulinette/")) { found.add(item); continue; }
      const walked = stripMoulinette(item, found);
      if (walked !== undefined) kept.push(walked);
    }
    return kept;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let viable = true;
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string" && v.startsWith("@moulinette/")) { found.add(v); viable = false; continue; }
      const walked = stripMoulinette(v, found);
      if (walked === undefined) continue;
      out[k] = walked;
    }
    return viable ? out : undefined;
  }
  return value;
}

/**
 * Stamp `_id` and `_key` on embedded documents, recursing.
 *
 * Keys nest by collection path, so an effect on an item is
 * `!items.effects!<item>.<effect>` and an effect on an item *on an actor* is
 * `!actors.items.effects!<actor>.<item>.<effect>`. The Foundry CLI refuses to
 * invent these and fails the whole pack with "Key cannot be null or
 * undefined", naming neither the document nor the field.
 */
export function keyEmbedded(
  doc: Record<string, unknown>, collection: string, idPath: string,
): void {
  for (const [field, list] of Object.entries(doc)) {
    if (!Array.isArray(list) || !EMBEDDED_FIELDS.has(field)) continue;
    list.forEach((entry, i) => {
      if (!entry || typeof entry !== "object") return;
      const child = entry as Record<string, unknown>;
      if (typeof child["_id"] !== "string" || !child["_id"]) {
        child["_id"] = derivedId(`${idPath}:${field}:${i}`);
      }
      const nextCollection = `${collection}.${field}`;
      const nextPath = `${idPath}.${child["_id"] as string}`;
      child["_key"] = `!${nextCollection}!${nextPath}`;
      keyEmbedded(child, nextCollection, nextPath);
    });
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(source)) {
    const existing = target[k];
    if (v && typeof v === "object" && !Array.isArray(v)
        && existing && typeof existing === "object" && !Array.isArray(existing)) {
      deepMerge(existing as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/**
 * Locate the Foundry CLI without depending on it.
 *
 * It is an optional peer: it pulls classic-level, and making every user of
 * this package pay for a native build so that a minority can compile a module
 * is the wrong trade. Absent, the build says what to install rather than
 * failing with a resolution error nobody can act on.
 */
async function findFoundryCli(vaultPath: string): Promise<string | null> {
  const roots = [import.meta.url, `file://${join(vaultPath, "x")}`, `file://${join(process.cwd(), "x")}`];
  // A global install is not on any of those resolution paths, and telling
  // someone to install globally and then failing to find it is worse than not
  // suggesting it — so ask npm where its global root is and look there too.
  try {
    const { stdout } = await execFileAsync("npm", ["root", "-g"]);
    roots.push(`file://${join(stdout.trim(), "x")}`);
  } catch { /* npm not on PATH; the local roots may still have it */ }
  for (const from of roots) {
    try {
      const pkg = createRequire(from).resolve("@foundryvtt/foundryvtt-cli/package.json");
      return join(dirname(pkg), "fvtt.mjs");
    } catch { /* try the next root */ }
  }
  return null;
}

export interface ModuleOptions {
  vaultPath: string;
  vaultId: string;
  /** Vault-relative directory the manifest and zip are written to. */
  outputDir: string;
  /**
   * A rendered deploy to take journal HTML from. The wiki's own output, so a
   * page's handlers and `fm:` values are in it; re-rendering the markdown
   * would ship a different article than the site shows. Absent, the module
   * carries documents only.
   */
  renderedDir?: string;
  /** Which variant subdirectory the rendered bodies live in. */
  renderedRole?: string;
}

/** Just enough of a page for the module: where it is, what it is called, and
 *  its foundry block. Scanned here rather than threaded out of buildSite,
 *  because the module has to be written before that build lists its files —
 *  otherwise the zip it produces is invisible to the very build that ships it. */
interface ModulePage {
  path: string;
  title: string;
  body: string;
  role: string;
  image: string;
  foundry: Record<string, unknown> | null;
}

async function scanPages(
  vaultPath: string, defaultRole: string, rules: CompiledRule[],
): Promise<ModulePage[]> {
  const files = await scanVault(vaultPath);
  const pages: ModulePage[] = [];
  for (const f of files) {
    // index.md is included. The compendium side skipped it, which was right
    // for a folder overview that is not itself an entry — but it has no
    // foundry.base, so the document pass drops it anyway. The journal side
    // needs it: sync makes a page for every .md in a directory, and dropping
    // index pages both loses the article and turns every [[index]] link in
    // the vault into plain text.
    if (!/\.md$/i.test(f.path)) continue;
    const parsed = matter(await readFile(f.absolute, "utf8"));
    // Same defaults the wiki and the sync manifest see — the compiler must not
    // read a different version of the page than they do.
    const fm = applyFrontmatterDefaults(f.path, parsed.data as Record<string, unknown>, rules);
    const fo = fm["foundry"];
    pages.push({
      path: f.path,
      title: typeof fm["title"] === "string" ? fm["title"] : f.path.split("/").pop()!.replace(/\.md$/i, ""),
      body: parsed.content,
      role: typeof fm["role"] === "string" && fm["role"] ? fm["role"] : defaultRole,
      image: typeof fm["image"] === "string" ? fm["image"] : "",
      foundry: fo && typeof fo === "object" && !Array.isArray(fo) ? fo as Record<string, unknown> : null,
    });
  }
  return pages;
}

/**
 * Which pack a page belongs in.
 *
 * Declarations win where they exist: a vault that wants Spells and Items as
 * two Item packs has to say so, because grouping by document type cannot know
 * that Foundry treats them as separate compendiums while the schema does not.
 * Without declarations, one pack per document type is a reasonable default and
 * needs no configuration at all — which is what a small vault wants.
 */
function assignPack(page: ModulePage, docType: string, decls: PackDecl[], moduleId: string): PackDecl | null {
  for (const decl of decls) {
    const prefix = `${decl.folder}/`;
    if (page.path.startsWith(prefix) || page.path.includes(`/${prefix}`)) {
      return decl.type === docType ? decl : null;
    }
  }
  if (decls.length > 0) return null;
  return {
    folder: "", name: `${moduleId}-${PACK_KEY[docType]}`,
    label: `${docType}`, type: docType,
  };
}

/** The page's folder path inside its pack, for compendium folders. */
function subfolderOf(page: ModulePage, decl: PackDecl): string {
  const override = page.foundry?.["folder"];
  if (typeof override === "string" && override.trim()) return override.trim().replace(/^\/+|\/+$/g, "");
  const dir = page.path.split("/").slice(0, -1).join("/");
  if (!decl.folder) return dir;
  const marker = `${decl.folder}/`;
  const at = dir.indexOf(marker);
  return at === -1 ? "" : dir.slice(at + marker.length);
}

/**
 * Build the module. Returns null (having said why) when the vault has no
 * module.json to build from, which is how a vault opts out by not having one.
 */
export async function buildFoundryModule(opts: ModuleOptions): Promise<ModuleResult | null> {
  // The module lives wherever its manifest does. A vault that distributes
  // through its own deploy keeps one at the root; a vault that already has a
  // module directory it maintains by hand — lang files, styles, Babele
  // translations — keeps one there, and the compiled packs belong beside them.
  let manifest: Record<string, unknown> | null = null;
  let moduleDirRel = "";
  for (const dir of ["", "foundry"]) {
    try {
      manifest = JSON.parse(
        await readFile(join(opts.vaultPath, dir, "module.json"), "utf8"),
      ) as Record<string, unknown>;
      moduleDirRel = dir;
      break;
    } catch { /* try the other location */ }
  }
  if (!manifest) {
    console.warn(
      "  --module: no module.json at the vault root or in foundry/. Add one with"
      + ' at least { "id", "title", "version", "compatibility" } — every other key'
      + " you put there is preserved, only `packs` is rewritten.",
    );
    return null;
  }
  const moduleId = typeof manifest["id"] === "string" ? manifest["id"] : "";
  if (!moduleId) {
    console.warn("  --module: module.json needs a string `id`.");
    return null;
  }
  const version = typeof manifest["version"] === "string" ? manifest["version"] : "0.0.0";
  const stats = statsFor(manifest);
  const flags = (manifest["flags"] ?? {}) as Record<string, Record<string, unknown>>;
  const decls = ((flags["vaults"]?.["packs"] ?? flags["vfmc"]?.["packs"]) ?? []) as PackDecl[];

  // Which roles may be redistributed.
  //
  // A module is handed to other people, so the default is the vault's lowest
  // role and nothing else: a `role: dm` page carries content its author chose
  // not to publish, and compiling it into a downloadable zip publishes it
  // further than the wiki ever would. Widening is possible but has to be said
  // out loud, in module.json, rather than being the default nobody checked.
  const cfg = await loadConfig(opts.vaultPath, {});
  const roles = cfg.roles.length > 0 ? cfg.roles : ["public"];
  const settings = await loadSettings(opts.vaultPath);
  const configuredDefault = String(settings.values.default_role ?? "");
  const defaultRole = roles.includes(configuredDefault) ? configuredDefault : roles[0]!;
  const declaredRoles = flags["vaults"]?.["roles"];
  const allowedRoles = new Set(
    Array.isArray(declaredRoles) && declaredRoles.length > 0
      ? declaredRoles.filter((r): r is string => typeof r === "string")
      : [roles[0]!],
  );

  const cli = await findFoundryCli(opts.vaultPath);
  if (!cli) {
    console.warn(
      "  --module: needs @foundryvtt/foundryvtt-cli to write compendium packs, which is not"
      + " installed. It is optional on purpose (it builds LevelDB bindings), so:"
      + "\n    npm i -g @foundryvtt/foundryvtt-cli",
    );
    return null;
  }

  // ── First pass: decide what each page compiles to ───────────────────────
  interface Planned {
    page: ModulePage;
    decl: PackDecl;
    docType: string;
    subtype?: string;
    id: string;
  }
  const skipped: ModuleSkip[] = [];
  const planned: Planned[] = [];

  // Vault files by path, plus a basename key, so a cover written the Obsidian
  // way (a bare filename) resolves the same as a full path.
  const imageIndex = new Map<string, string>();
  for (const f of await scanVault(opts.vaultPath)) {
    if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(f.path)) continue;
    imageIndex.set(f.path, f.path);
    const key = `basename:${f.path.split("/").pop()!.toLowerCase()}`;
    if (!imageIndex.has(key)) imageIndex.set(key, f.path);
  }

  const gated: string[] = [];
  const journalPages: ModulePage[] = [];
  const frontmatterRules = compileFrontmatterRules(settings.values.default_frontmatter);
  for (const page of await scanPages(opts.vaultPath, defaultRole, frontmatterRules)) {
    if (!allowedRoles.has(page.role)) { gated.push(page.path); continue; }
    // `sync: false` means the page is not for Foundry at all — no journal, no
    // document. A module is Foundry content by definition, so it honours that
    // the same way the sync path does.
    if (page.foundry?.["sync"] === false) continue;
    // `journal: false` exists for a page whose only job is to make a document.
    // It keeps its document and contributes no article, here as there.
    if (page.foundry?.["journal"] !== false) journalPages.push(page);
    if (!page.foundry) continue;
    const block = page.foundry;
    const specs = (Array.isArray(block["base"]) ? block["base"] : [block["base"]])
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (specs.length === 0) continue;

    const target = resolveSelfContainedBase(specs);
    if (!target) {
      skipped.push({
        path: page.path,
        reason: `base is ${specs.join(", ")} — nothing a module can build without the reader's own content`,
      });
      continue;
    }
    const decl = assignPack(page, target.blank, decls, moduleId);
    if (!decl) continue; // declared vault, page outside any declared pack
    if (specs.length > 1 && specs.filter((sp) => sp.includes(".") || sp.startsWith("@moulinette/")).length > 0) {
      skipped.push({
        path: page.path,
        reason: `built as a blank ${target.blank}; higher rung(s) need content this module cannot carry`,
      });
    }
    planned.push({
      page, decl, docType: target.blank,
      ...(target.subtype ? { subtype: target.subtype } : {}),
      id: typeof block["id"] === "string" && block["id"] ? block["id"] : documentId(opts.vaultId, page.path),
    });
  }

  if (gated.length > 0) {
    console.log(
      `    ${gated.length} page(s) left out: not in role(s) ${[...allowedRoles].join(", ")}.`
      + ` A module is redistributable, so gated pages stay out unless`
      + ` flags.vaults.roles says otherwise.`,
    );
  }
  if (planned.length === 0 && journalPages.length === 0) {
    console.warn("  --module: no page produced anything this module can carry; nothing built.");
    return null;
  }

  // Every compiled page, by name, so a wikilink between them becomes a real
  // @UUID cross-reference rather than losing its link and keeping its text.
  // Built before rendering, since a page can link to one compiled after it.
  const linkIndex = new Map<string, LinkEntry>();
  for (const p of planned) {
    const uuid = `Compendium.${moduleId}.${p.decl.name}.${p.docType}.${p.id}`;
    linkIndex.set(p.page.title.toLowerCase(), { uuid, name: p.page.title });
    const basename = p.page.path.split("/").pop()!.replace(/\.md$/i, "");
    if (!linkIndex.has(basename.toLowerCase())) linkIndex.set(basename.toLowerCase(), { uuid, name: basename });
  }

  // ── Journals ────────────────────────────────────────────────────────────
  //
  // Read from the rendered deploy rather than re-rendered from markdown, so a
  // page's battlemap, statblock and `fm:` values are the ones the wiki shows.
  const journalTargets = new Map<string, JournalTarget>();
  const journalSources: JournalSource[] = [];
  const journalPackName = `${moduleId}-journal`;
  // Journals mirror the sync model by default: a page becomes an article, and
  // a document made from that page embeds it, so the same vault produces the
  // same thing whether a reader synced it or installed it.
  //
  // A vault whose pages exist only to describe compendium entries can opt out
  // with `flags.vaults.journal: false`. That is a real case, not a
  // hypothetical: WANDS's prose is already the text of each item, so carrying
  // it a second time as an article would duplicate the whole compendium.
  // Which pages become articles is the page's own business, said the same way
  // it is said to the sync client: `foundry.journal: false`. A vault that wants
  // a whole folder excluded sets it once in default_frontmatter rather than in
  // module config, so a synced world and an installed module cannot disagree
  // about which pages have articles.
  if (opts.renderedDir) {
    for (const page of journalPages) {
      const html = await readRenderedBody(opts, page.path);
      if (html === null) continue;
      journalSources.push({ path: page.path, title: page.title, html });
      const eId = journalEntryId(moduleId, page.path);
      const pId = journalPageId(moduleId, page.path);
      journalTargets.set(page.path, {
        uuid: `Compendium.${moduleId}.${journalPackName}.JournalEntry.${eId}.JournalEntryPage.${pId}`,
        entryId: eId, pageId: pId,
      });
      // A link is written against the page's URL, which has no .md on it.
      journalTargets.set(page.path.replace(/\.md$/i, ""), journalTargets.get(page.path)!);
    }
  }

  // ── Second pass: assemble ───────────────────────────────────────────────
  const byPack = new Map<string, { decl: PackDecl; docs: Array<Record<string, unknown>>; entries: Array<{ key: Record<string, unknown>; folderPath: string }> }>();
  const assets = new Set<string>();
  const moulinette = new Set<string>();
  let documents = 0;

  for (const p of planned) {
    const block = p.page.foundry!;
    const prefix = PACK_KEY[p.docType]!;
    const doc: Record<string, unknown> = {
      _id: p.id,
      name: p.page.title,
      ...(p.subtype ? { type: p.subtype } : {}),
    };
    const dataJson = typeof block["data_json"] === "string"
      ? await loadDataJson(opts.vaultPath, block["data_json"], p.page.path)
      : null;
    if (dataJson) deepMerge(doc, dataJson as Record<string, unknown>);
    const inline = block["data"];
    if (inline && typeof inline === "object" && !Array.isArray(inline)) {
      deepMerge(doc, inline as Record<string, unknown>);
    }

    // The page's prose is the compendium entry for most types; a sidecar
    // exported from Foundry generally carries an empty description because
    // the writing lives in the vault.
    // `embed: false` exists to keep an article off a document sheet — usually
    // because the page carries DM-only material. Rendering the same body into
    // a module's description would do exactly what the flag forbids, and into
    // something redistributable.
    const descPath = block["embed"] === false ? "" : DESCRIPTION_PATH[p.docType];
    if (descPath) {
      const target = journalTargets.get(p.page.path);
      // Embed the module's own journal page, exactly as the sync path embeds
      // the world's. That is what makes a module document and a synced
      // document the same thing rather than two renderings of one page.
      // Falls back to inlined HTML when the module carries no journal.
      const html = target
        ? `<p>@Embed[${target.uuid} inline]</p>`
        : renderBody(p.page.body, linkIndex);
      // Set even when empty. A page whose prose lives entirely in a handler
      // fence renders to nothing, and a sheet reading an absent field is not
      // the same as one reading a blank string.
      setPath(doc, descPath, html);
      // dnd5e sheets read a sibling `chat` description and throw on undefined.
      // Walked with setPath rather than by hand: a page with no body never had
      // the intermediate objects created, and reaching through them crashed
      // the whole build on the first such page.
      if (p.docType === "Item" || p.docType === "Actor") {
        const chatPath = [...descPath.split(".").slice(0, -1), "chat"];
        const existing = chatPath.reduce<unknown>(
          (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), doc,
        );
        if (existing === undefined) setPath(doc, chatPath.join("."), "");
      }
    }
    doc["sort"] ??= 0;
    doc["flags"] ??= {};
    doc["ownership"] ??= { default: 0 };
    doc["_stats"] ??= stats;

    // The cover the wiki shows. The sync path sets a document's img from it,
    // and a prototype token for an Actor, so a module that skipped it would
    // hand over the same document with no picture.
    if (p.page.image) {
      const rel = resolveCover(p.page, imageIndex);
      if (rel) {
        assets.add(rel);
        const url = `modules/${moduleId}/assets/${rel}`;
        doc["img"] ??= url;
        if (p.docType === "Actor") {
          const token = (doc["prototypeToken"] ??= {}) as Record<string, unknown>;
          const texture = (token["texture"] ??= {}) as Record<string, unknown>;
          texture["src"] ??= url;
        }
      } else {
        console.warn(`    ${p.page.path}: cover image '${p.page.image}' not found in the vault.`);
      }
    }

    if (p.docType === "RollTable") assembleRollTableResults(doc, p.id, stats);

    const cleaned = stripMoulinette(doc, moulinette) as Record<string, unknown>;
    const withAssets = rewriteAssetPaths(cleaned, moduleId, assets) as Record<string, unknown>;

    const bucket = byPack.get(p.decl.name) ?? { decl: p.decl, docs: [], entries: [] };
    for (const variant of expandVariants(withAssets, block, prefix)) {
      variant["_key"] = `!${prefix}!${variant["_id"] as string}`;
      keyEmbedded(variant, prefix, variant["_id"] as string);
      bucket.docs.push(variant);
      bucket.entries.push({ key: variant, folderPath: subfolderOf(p.page, p.decl) });
      documents++;
    }
    byPack.set(p.decl.name, bucket);
  }

  if (journalSources.length > 0) {
    const entries = buildJournalEntries(journalSources, moduleId, String(manifest["title"] ?? moduleId), stats);
    for (const entry of entries) {
      for (const page of entry.pages) {
        const text = page["text"] as Record<string, unknown>;
        text["content"] = transformForModule(String(text["content"]), moduleId, journalTargets, assets);
      }
    }
    byPack.set(journalPackName, {
      decl: { folder: "", name: journalPackName, label: "", type: "JournalEntry" },
      docs: entries as unknown as Array<Record<string, unknown>>,
      entries: [],
    });
    documents += entries.length;
  }

  return finishModule(opts, manifest, moduleId, version, cli, byPack, assets, moulinette, skipped, documents, stats, moduleDirRel);
}

/**
 * Give a RollTable the shape Foundry expects.
 *
 * A page authors results as `{ text }` or `{ uuid }` with an optional weight
 * and range; a table document wants each one typed, named, ranged, imaged and
 * keyed. Foundry does not fill these in — a result with no `type` simply never
 * draws — so the compiler does, rather than making every page restate the same
 * nine fields.
 */
function assembleRollTableResults(
  doc: Record<string, unknown>, tableId: string, stats: Record<string, unknown>,
): void {
  const raw = Array.isArray(doc["results"]) ? doc["results"] as Array<Record<string, unknown>> : [];
  doc["results"] = raw.map((r, i) => {
    const rid = derivedId(`${tableId}:${i}`);
    const uuid = typeof r["uuid"] === "string" ? r["uuid"] : "";
    const isDoc = uuid.length > 0;
    const text = typeof r["text"] === "string" ? r["text"] : "";
    return {
      _id: rid,
      type: isDoc ? "document" : "text",
      name: isDoc ? text : "",
      description: isDoc ? "" : text,
      ...(isDoc ? { documentUuid: uuid } : {}),
      img: r["img"] ?? "icons/svg/d20-black.svg",
      weight: r["weight"] ?? 1,
      range: r["range"] ?? [i + 1, i + 1],
      drawn: false,
      flags: {},
      _stats: stats,
      _key: `!tables.results!${tableId}.${rid}`,
    };
  });
  doc["img"] ??= "icons/svg/d20-grey.svg";
  doc["formula"] ??= `1d${raw.length || 1}`;
  doc["replacement"] ??= true;
  doc["displayRoll"] ??= true;
}

/**
 * The wiki's rendered body for a page, or null when the deploy has none.
 *
 * A single-role build collapses its variant to the deploy root, so both
 * layouts are tried rather than deriving which one applies.
 */
async function readRenderedBody(opts: ModuleOptions, pagePath: string): Promise<string | null> {
  const rel = pagePath.replace(/\.md$/i, ".body.html");
  const candidates = opts.renderedRole
    ? [join(opts.renderedDir!, "_variants", opts.renderedRole, rel), join(opts.renderedDir!, rel)]
    : [join(opts.renderedDir!, rel)];
  for (const c of candidates) {
    try { return await readFile(c, "utf8"); } catch { /* try the other layout */ }
  }
  return null;
}

/**
 * Resolve an `image:` value to a vault-relative path.
 *
 * Obsidian lets a cover be a bare basename, so accept that as well as a real
 * path, the same way the wiki's own image index does.
 */
function resolveCover(page: ModulePage, index: Map<string, string>): string | null {
  const raw = page.image.replace(/^\/+/, "");
  if (index.has(raw)) return raw;
  const sibling = [...page.path.split("/").slice(0, -1), raw].join("/");
  if (index.has(sibling)) return sibling;
  return index.get(`basename:${raw.split("/").pop()!.toLowerCase()}`) ?? null;
}

/** A page with `foundry.variants` becomes one document per variant. */
function expandVariants(
  base: Record<string, unknown>, block: Record<string, unknown>, prefix: string,
): Array<Record<string, unknown>> {
  const variants = block["variants"];
  if (!Array.isArray(variants) || variants.length === 0) return [base];
  return variants.map((v) => {
    const entry = v as { id?: string; data?: Record<string, unknown> };
    const clone = structuredClone(base);
    if (entry.data) deepMerge(clone, entry.data);
    if (entry.id) clone["_id"] = entry.id;
    clone["_key"] = `!${prefix}!${clone["_id"] as string}`;
    return clone;
  });
}

interface PackBucket {
  decl: PackDecl;
  docs: Array<Record<string, unknown>>;
  entries: Array<{ key: Record<string, unknown>; folderPath: string }>;
}

/** Write the packs, the manifest and the zip, and report what was left out. */
async function finishModule(
  opts: ModuleOptions,
  manifest: Record<string, unknown>,
  moduleId: string,
  version: string,
  cli: string,
  byPack: Map<string, PackBucket>,
  assets: Set<string>,
  moulinette: Set<string>,
  skipped: ModuleSkip[],
  documents: number,
  stats: Record<string, unknown>,
  moduleDirRel: string,
): Promise<ModuleResult> {
  // Two ways a module reaches a reader, and the manifest already says which.
  //
  // A manifest that names its own `download` is published elsewhere — a
  // GitHub release, usually — so the compiled packs belong beside it, in the
  // module directory its own release tooling zips, and those URLs are the
  // author's to manage. Rewriting them would break the versioned-URL dance a
  // release script does at tag time.
  //
  // A manifest with no `download` is served by this vault, so it gets a zip in
  // the deploy and a relative URL pointing at it.
  const inPlace = typeof manifest["download"] === "string" && manifest["download"].length > 0;
  const staging = await mkdtemp(join(tmpdir(), "vaults-module-"));
  const moduleDir = inPlace ? join(opts.vaultPath, moduleDirRel) : join(staging, moduleId);
  const jsonDir = join(staging, "_json");
  await mkdir(join(moduleDir, "packs"), { recursive: true });

  const packs: Array<Record<string, unknown>> = [];
  const packNames: string[] = [];
  for (const [packName, bucket] of byPack) {
    const dir = join(jsonDir, packName);
    await mkdir(dir, { recursive: true });

    // Compendium folders are documents in the pack too, so a pack of five
    // hundred items is browsable instead of one flat list.
    const { folderDocs, leafFor } = buildFolders(
      bucket.entries, packName, bucket.decl.type, stats,
    );
    for (const entry of bucket.entries) entry.key["folder"] = leafFor.get(entry.key) ?? null;
    for (const folder of folderDocs) {
      await writeFile(join(dir, `folder-${folder._id}.json`), JSON.stringify(folder, null, 2));
    }
    for (const doc of bucket.docs) {
      await writeFile(join(dir, `${doc["_id"] as string}.json`), JSON.stringify(doc, null, 2));
    }
    await execFileAsync(process.execPath, [
      cli, "package", "pack", "-n", packName, "--type", "Module", "--id", moduleId,
      "--in", dir, "--out", join(moduleDir, "packs"),
    ]);
    packs.push({
      name: packName,
      label: bucket.decl.folder ? bucket.decl.label
        : `${manifest["title"] ?? moduleId}: ${PACK_LABEL[bucket.decl.type] ?? bucket.decl.type}`,
      path: `packs/${packName}`,
      type: bucket.decl.type,
      ...(typeof manifest["system"] === "string" ? { system: manifest["system"] } : {}),
    });
    packNames.push(packName);
    console.log(`    ${packName}: ${bucket.docs.length} document(s), ${folderDocs.length} folder(s)`);
  }

  for (const rel of assets) {
    const from = join(opts.vaultPath, rel);
    const to = join(moduleDir, "assets", rel);
    try {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
    } catch {
      console.warn(`    asset '${rel}' is referenced but missing; the module will point at nothing.`);
    }
  }
  if (assets.size > 0) console.log(`    ${assets.size} asset(s) bundled`);

  // Own only `packs`, the way vfmc does: everything else the author put in
  // module.json is theirs and survives.
  manifest["packs"] = packs;
  const zipName = `${moduleId}-${version}.zip`;
  let manifestPath: string;
  let zipPath = "";

  if (inPlace) {
    manifestPath = join(moduleDir, "module.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  } else {
    const outDir = join(opts.vaultPath, opts.outputDir);
    await mkdir(outDir, { recursive: true });
    manifestPath = join(outDir, "module.json");
    // Relative, so it resolves on whichever host serves the vault and can be
    // signed for a gated install. An absolute URL cannot be either.
    manifest["download"] = `/${opts.outputDir}/${zipName}`;
    manifest["manifest"] = `/${opts.outputDir}/module.json`;
    await writeFile(join(moduleDir, "module.json"), JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    zipPath = join(opts.vaultPath, opts.outputDir, zipName);
    await rm(zipPath, { force: true });
    await execFileAsync("zip", ["-qr", resolve(zipPath), moduleId], { cwd: staging });
  }
  await rm(staging, { recursive: true, force: true });

  if (moulinette.size > 0) {
    console.warn(
      `    ${moulinette.size} @moulinette/ reference(s) dropped: a standalone module cannot`
      + ` resolve them, since that happens against the reader's own library at sync time.`,
    );
  }
  if (skipped.length > 0) {
    console.warn(`    ${skipped.length} page(s) not fully carried:`);
    for (const s of skipped.slice(0, 8)) console.warn(`      ${s.path}: ${s.reason}`);
    if (skipped.length > 8) console.warn(`      … and ${skipped.length - 8} more`);
    console.warn(
      `      To redistribute that content, build those documents yourself and put them in`
      + ` the page's data_json — a module may not carry someone else's compendium.`,
    );
  }
  return { moduleId, version, documents, packs: packNames, skipped, manifestPath, zipPath };
}
