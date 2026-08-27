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
import { loadDataJson } from "./foundry-meta.js";
import { scanVault } from "./scan.js";

const execFileAsync = promisify(execFile);

/** Document types a blank can be made for; mirrors foundry/scripts/foundry-base.mjs. */
const BLANK_DOC_TYPES = [
  "Actor", "Item", "Scene", "JournalEntry", "RollTable", "Macro", "Cards", "Playlist",
];

/**
 * Embedded collections that a LevelDB pack stores as their own keyed entries
 * rather than inline in the parent. Each member needs an `_id` and a `_key` of
 * the form `!<parent>.<collection>!<parentId>.<childId>`, and the Foundry CLI
 * fails with "Key cannot be null or undefined" when one is missing — which
 * names neither the document nor the field, so it is worth being explicit here.
 */
const EMBEDDED: Record<string, string[]> = {
  Actor: ["items", "effects"],
  Item: ["effects"],
  RollTable: ["results"],
  JournalEntry: ["pages"],
  Playlist: ["sounds"],
  Cards: ["cards"],
  Scene: ["drawings", "lights", "notes", "sounds", "templates", "tiles", "tokens", "walls", "regions"],
};

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
  const blank = BLANK_DOC_TYPES.find((t) => t.toLowerCase() === (typeRaw ?? "").toLowerCase());
  return blank ? { blank, ...(subtype ? { subtype } : {}) } : null;
}

/** The last rung of a `foundry.base` a module can build on its own, or null. */
export function resolveSelfContainedBase(specs: string[]): { blank: string; subtype?: string } | null {
  const parsed = specs.map(parseBase).filter((p): p is { blank: string; subtype?: string } => p !== null);
  return parsed.length > 0 ? parsed[parsed.length - 1]! : null;
}

/** A stable 16-char Foundry id derived from the page path. */
function documentId(vaultId: string, pagePath: string): string {
  const hex = createHash("sha1").update(`vaults-module:${vaultId}:${pagePath}`).digest("hex");
  // Foundry ids are [A-Za-z0-9]{16}; hex qualifies and stays deterministic.
  return hex.slice(0, 16);
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
 * Give every embedded document an `_id` and `_key`, deriving stable ids for
 * any that lack one so a rebuild does not renumber the pack.
 */
export function keyEmbedded(
  doc: Record<string, unknown>, docType: string, prefix: string, parentId: string,
): void {
  for (const collection of EMBEDDED[docType] ?? []) {
    const list = doc[collection];
    if (!Array.isArray(list)) continue;
    list.forEach((entry, i) => {
      if (!entry || typeof entry !== "object") return;
      const child = entry as Record<string, unknown>;
      if (typeof child["_id"] !== "string" || !child["_id"]) {
        child["_id"] = createHash("sha1")
          .update(`${parentId}:${collection}:${i}`).digest("hex").slice(0, 16);
      }
      child["_key"] = `!${prefix}.${collection}!${parentId}.${child["_id"] as string}`;
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
}

/** Just enough of a page for the module: where it is, what it is called, and
 *  its foundry block. Scanned here rather than threaded out of buildSite,
 *  because the module has to be written before that build lists its files —
 *  otherwise the zip it produces is invisible to the very build that ships it. */
interface ModulePage {
  path: string;
  title: string;
  foundry: Record<string, unknown> | null;
}

async function scanPages(vaultPath: string): Promise<ModulePage[]> {
  const files = await scanVault(vaultPath);
  const pages: ModulePage[] = [];
  for (const f of files) {
    if (!/\.md$/i.test(f.path)) continue;
    const parsed = matter(await readFile(f.absolute, "utf8"));
    const fm = parsed.data as Record<string, unknown>;
    const fo = fm["foundry"];
    pages.push({
      path: f.path,
      title: typeof fm["title"] === "string" ? fm["title"] : "",
      foundry: fo && typeof fo === "object" && !Array.isArray(fo) ? fo as Record<string, unknown> : null,
    });
  }
  return pages;
}

/**
 * Build the module. Returns null (having said why) when the vault has no
 * module.json to build from, which is how a vault opts out simply by not
 * having one.
 */
export async function buildFoundryModule(opts: ModuleOptions): Promise<ModuleResult | null> {
  const manifestSource = join(opts.vaultPath, "module.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(manifestSource, "utf8")) as Record<string, unknown>;
  } catch {
    console.warn(
      "  --module: no module.json at the vault root. Add one with at least"
      + ' { "id", "title", "version", "compatibility" } — every other key you put'
      + " there is preserved, only `packs` is rewritten.",
    );
    return null;
  }
  const moduleId = typeof manifest["id"] === "string" ? manifest["id"] : "";
  if (!moduleId) {
    console.warn("  --module: module.json needs a string `id`.");
    return null;
  }
  const version = typeof manifest["version"] === "string" ? manifest["version"] : "0.0.0";

  const cli = await findFoundryCli(opts.vaultPath);
  if (!cli) {
    console.warn(
      "  --module: needs @foundryvtt/foundryvtt-cli to write compendium packs, which is not"
      + " installed. It is optional on purpose (it builds LevelDB bindings), so:"
      + "\n    npm i -g @foundryvtt/foundryvtt-cli",
    );
    return null;
  }

  // ── Collect what the vault can build on its own ─────────────────────────
  const skipped: ModuleSkip[] = [];
  const byType = new Map<string, Array<Record<string, unknown>>>();
  const assets = new Set<string>();
  const moulinette = new Set<string>();
  let documents = 0;

  for (const page of await scanPages(opts.vaultPath)) {
    if (!page.foundry) continue;
    const block = page.foundry;
    const specs = (Array.isArray(block["base"]) ? block["base"] : [block["base"]])
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (specs.length === 0) continue;

    // The last self-contained rung: a standalone module is exactly the case a
    // priority list's fallback exists for.
    const parsed = specs.map(parseBase).filter((p): p is { blank: string; subtype?: string } => p !== null);
    if (parsed.length === 0) {
      skipped.push({
        path: page.path,
        reason: `base is ${specs.join(", ")} — nothing a module can build without the reader's own content`,
      });
      continue;
    }
    const target = parsed[parsed.length - 1]!;
    if (parsed.length < specs.length) {
      skipped.push({
        path: page.path,
        reason: `built as a blank ${target.blank}; ${specs.length - parsed.length} higher rung(s) need content this module cannot carry`,
      });
    }

    const doc: Record<string, unknown> = {
      _id: typeof block["id"] === "string" && block["id"] ? block["id"] : documentId(opts.vaultId, page.path),
      name: page.title || page.path.split("/").pop()!.replace(/\.md$/i, ""),
      ...(target.subtype ? { type: target.subtype } : {}),
    };

    const dataJson = typeof block["data_json"] === "string"
      ? await loadDataJson(opts.vaultPath, block["data_json"], page.path)
      : null;
    if (dataJson) deepMerge(doc, dataJson as Record<string, unknown>);
    const inline = block["data"];
    if (inline && typeof inline === "object" && !Array.isArray(inline)) {
      deepMerge(doc, inline as Record<string, unknown>);
    }

    // A module cannot resolve @moulinette/ — that is the sync module's job,
    // against a library this module will never see.
    const cleaned = stripMoulinette(doc, moulinette) as Record<string, unknown>;
    const withAssets = rewriteAssetPaths(cleaned, moduleId, assets) as Record<string, unknown>;
    const prefix = PACK_KEY[target.blank]!;
    const parentId = withAssets["_id"] as string;
    withAssets["_key"] = `!${prefix}!${parentId}`;
    keyEmbedded(withAssets, target.blank, prefix, parentId);

    const list = byType.get(target.blank) ?? [];
    list.push(withAssets);
    byType.set(target.blank, list);
    documents++;
  }

  if (documents === 0) {
    console.warn("  --module: no page produced a document this module can carry; nothing built.");
    return null;
  }
  return finishModule(opts, manifest, moduleId, version, cli, byType, assets, moulinette, skipped, documents);
}

/** Write the packs, the manifest and the zip, and report what was left out. */
async function finishModule(
  opts: ModuleOptions,
  manifest: Record<string, unknown>,
  moduleId: string,
  version: string,
  cli: string,
  byType: Map<string, Array<Record<string, unknown>>>,
  assets: Set<string>,
  moulinette: Set<string>,
  skipped: ModuleSkip[],
  documents: number,
): Promise<ModuleResult> {
  const staging = await mkdtemp(join(tmpdir(), "vaults-module-"));
  const moduleDir = join(staging, moduleId);
  const jsonDir = join(staging, "_json");
  await mkdir(join(moduleDir, "packs"), { recursive: true });

  // One pack per document type. Grouping by type rather than by vault folder
  // because Foundry packs are typed: a pack holds one kind of document, and a
  // folder generally does not.
  const packs: Array<Record<string, unknown>> = [];
  const packNames: string[] = [];
  for (const [docType, docs] of byType) {
    const packName = `${moduleId}-${PACK_KEY[docType]}`;
    const dir = join(jsonDir, packName);
    await mkdir(dir, { recursive: true });
    for (const doc of docs) {
      await writeFile(join(dir, `${doc["_id"] as string}.json`), JSON.stringify(doc, null, 2));
    }
    await execFileAsync(process.execPath, [
      cli, "package", "pack", "-n", packName, "--type", "Module", "--id", moduleId,
      "--in", dir, "--out", join(moduleDir, "packs"),
    ]);
    packs.push({
      name: packName,
      label: `${manifest["title"] ?? moduleId}: ${PACK_LABEL[docType] ?? docType}`,
      path: `packs/${packName}`,
      type: docType,
      ...(typeof manifest["system"] === "string" ? { system: manifest["system"] } : {}),
    });
    packNames.push(packName);
    console.log(`    ${packName}: ${docs.length} ${docType} document(s)`);
  }

  // Assets the documents point at, carried so the module stands alone.
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
  const outDir = join(opts.vaultPath, opts.outputDir);
  await mkdir(outDir, { recursive: true });
  const manifestPath = join(outDir, "module.json");
  const zipName = `${moduleId}-${version}.zip`;

  // Relative, so it resolves on whichever host serves the vault and can be
  // signed for a gated install. An absolute URL cannot be either.
  manifest["download"] = `/${opts.outputDir}/${zipName}`;
  manifest["manifest"] = `/${opts.outputDir}/module.json`;
  await writeFile(join(moduleDir, "module.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const zipPath = join(outDir, zipName);
  await rm(zipPath, { force: true });
  await execFileAsync("zip", ["-qr", resolve(zipPath), moduleId], { cwd: staging });
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
