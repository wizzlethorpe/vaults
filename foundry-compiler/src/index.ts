#!/usr/bin/env node
// vfmc (vaults foundry module compiler) — compile a wizzlethorpe vault into the
// Foundry VTT module that lives at <vault>/foundry/. It writes the LevelDB packs
// and owns ONLY the `packs` array of module.json; every other key the user
// authored (esmodules, relationships, languages, styles, Babele config, …) is
// preserved. Pack declarations come from module.json `flags.vfmc.packs`.
//
// Input  : <vault>/Compendium pages with `foundry: { base, id, data_json, folder }`
//          frontmatter (+ `.foundry.json` sidecars; roll tables carry inline
//          `foundry.data`), and <vault>/foundry/module.json with flags.vfmc.packs.
// Output : <out>/module.json (merged) and <out>/packs/<pack>/ (LevelDB).
//          <out> defaults to <vault>/foundry.
//
// Usage:  vfmc <vaultPath> [--out <dir>]

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { renderBody, type LinkEntry } from "./render.js";
import { compilePacks } from "./packs.js";
import { buildFolders } from "./folders.js";
import { buildPacksArray, type Manifest, type PackDecl } from "./manifest.js";

interface DocMeta {
  /** LevelDB collection prefix for `_key`. */
  key: string;
  /** Dot-path where the rendered body HTML lands. */
  descPath: string;
}

// Per-document-type: LevelDB collection prefix + where the description lands.
const DOC_META: Record<string, DocMeta> = {
  Item: { key: "items", descPath: "system.description.value" },
  Actor: { key: "actors", descPath: "system.details.biography.value" },
  RollTable: { key: "tables", descPath: "description" },
};

const DEFAULT_STATS = {
  systemId: "dnd5e", systemVersion: "5.3.0", coreVersion: "14.359",
  createdTime: null, modifiedTime: null, lastModifiedBy: null,
  compendiumSource: null, duplicateSource: null, exportSource: null,
};

interface FoundryBlock {
  base: string;
  id: string;
  data_json?: string;
  data?: Record<string, unknown>;
  folder?: string;
}

interface Page {
  pack: PackDecl;
  body: string;
  foundry: FoundryBlock;
  docType: string;
  /** Subfolder path under Compendium/<pack.folder>/ ("" when flat). */
  subfolder: string;
  name: string;
}

function parseArgs(argv: string[]): { vault: string; out: string } {
  const args = argv.slice(2);
  const vaultArg = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
  const vault = path.resolve(vaultArg ?? ".");
  const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
  return { vault, out: outArg ? path.resolve(outArg) : path.join(vault, "foundry") };
}

function parseFrontmatter(md: string): { fm: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: md };
  return { fm: (yaml.load(m[1]!) ?? {}) as Record<string, unknown>, body: m[2]! };
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

/** Collect every compilable page across all packs, recursing into subfolders. */
function discoverPages(vault: string, decls: PackDecl[]): Page[] {
  const pages: Page[] = [];
  for (const pack of decls) {
    const root = path.join(vault, "Compendium", pack.folder);
    if (!fs.existsSync(root)) {
      console.warn(`  [skip] pack ${pack.name}: ${root} missing`);
      continue;
    }
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".md") || entry.name === "index.md") continue;
        const { fm, body } = parseFrontmatter(fs.readFileSync(full, "utf8"));
        const fo = fm.foundry as FoundryBlock | undefined;
        if (!fo?.base || !fo?.id) {
          console.warn(`  [skip] ${pack.folder}/${entry.name}: no foundry.base/id`);
          continue;
        }
        const docType = String(fo.base).split(":")[0]!;
        const subfolder = path.relative(root, dir).split(path.sep).join("/");
        pages.push({
          pack, body, foundry: fo, docType, subfolder,
          name: (fm.title as string) ?? entry.name.replace(/\.md$/, ""),
        });
      }
    };
    walk(root);
  }
  return pages;
}

/** name (lowercased) → { uuid, name } for @UUID cross-link resolution. */
function buildLinkIndex(pages: Page[], moduleId: string): Map<string, LinkEntry> {
  const index = new Map<string, LinkEntry>();
  for (const p of pages) {
    const uuid = `Compendium.${moduleId}.${p.pack.name}.${p.docType}.${p.foundry.id}`;
    index.set(p.name.toLowerCase(), { uuid, name: p.name });
  }
  return index;
}

/** Deterministic 16-char [A-Za-z0-9] id for an embedded sub-document. */
function subId(seed: string, i: number): string {
  return crypto.createHash("sha1").update(`${seed}:${i}`).digest("base64")
    .replace(/[^A-Za-z0-9]/g, "").slice(0, 16).padEnd(16, "0");
}

/** Expand a roll table page's inline `foundry.data` into a full Foundry RollTable. */
function assembleRollTable(page: Page, html: string): Record<string, unknown> {
  const data = page.foundry.data ?? {};
  const tableId = page.foundry.id;
  const rawResults = (Array.isArray(data.results) ? data.results : []) as Array<Record<string, unknown>>;
  const results = rawResults.map((r, i) => {
    const rid = subId(tableId, i);
    const uuid = typeof r.uuid === "string" ? r.uuid : "";
    const isDoc = uuid.length > 0;
    const text = typeof r.text === "string" ? r.text : "";
    return {
      _id: rid,
      type: isDoc ? "document" : "text",
      name: isDoc ? text : "",
      description: isDoc ? "" : text,
      ...(isDoc ? { documentUuid: uuid } : {}),
      img: r.img ?? "icons/svg/d20-black.svg",
      weight: r.weight ?? 1,
      range: r.range ?? [i + 1, i + 1],
      drawn: false,
      flags: {},
      _stats: DEFAULT_STATS,
      _key: `!tables.results!${tableId}.${rid}`,
    };
  });
  return {
    _id: tableId,
    name: page.name,
    img: data.img ?? "icons/svg/d20-grey.svg",
    description: html,
    formula: data.formula ?? `1d${results.length || 1}`,
    replacement: true,
    displayRoll: true,
    results,
    folder: null,
    sort: 0,
    flags: {},
    ownership: { default: 0 },
    _stats: DEFAULT_STATS,
    _key: `!tables!${tableId}`,
  };
}

function assembleDoc(page: Page, vault: string, index: Map<string, LinkEntry>): Record<string, unknown> {
  const meta = DOC_META[page.docType];
  if (!meta) throw new Error(`unsupported foundry.base type "${page.docType}" (${page.name})`);

  const html = renderBody(page.body, index);

  // Roll tables carry their data inline in foundry.data (no sidecar).
  if (page.docType === "RollTable") return assembleRollTable(page, html);

  const sidecar = JSON.parse(fs.readFileSync(path.join(vault, page.foundry.data_json!), "utf8")) as Record<string, unknown>;
  const doc: Record<string, unknown> = {
    _id: page.foundry.id,
    name: page.name,
    ...sidecar,
    folder: null,
    sort: 0,
    flags: {},
    ownership: { default: 0 },
    _stats: DEFAULT_STATS,
    _key: `!${meta.key}!${page.foundry.id}`,
  };
  setPath(doc, meta.descPath, html);
  if (page.docType === "Item" || page.docType === "Actor") {
    const desc = meta.descPath.split(".").slice(0, -1)
      .reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, doc);
    if (desc.chat === undefined) desc.chat = "";
  }
  return doc;
}

/** Foundry pack `system` id: explicit `system`, else the required-system relationship. */
function systemId(manifest: Manifest): string | undefined {
  if (typeof manifest.system === "string") return manifest.system;
  const rel = manifest.relationships as { requires?: Array<{ id?: string; type?: string }> } | undefined;
  return rel?.requires?.find((r) => r.type === "system")?.id;
}

function main(): void {
  const { vault, out } = parseArgs(process.argv);
  const outModuleJson = path.join(out, "module.json");
  const seedModuleJson = path.join(vault, "foundry", "module.json");
  const manifestPath = fs.existsSync(outModuleJson) ? outModuleJson : seedModuleJson;
  if (!fs.existsSync(manifestPath)) {
    console.error(`No module.json at ${outModuleJson} or ${seedModuleJson}.`);
    console.error("Seed <vault>/foundry/module.json with flags.vfmc.packs first.");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  const decls = manifest.flags?.vfmc?.packs;
  if (!decls?.length) {
    console.error(`${manifestPath} has no flags.vfmc.packs to compile.`);
    process.exit(1);
  }
  const moduleId = manifest.id;
  console.log(`Compiling vault → Foundry module "${moduleId}" (${vault})\n`);

  const pages = discoverPages(vault, decls);
  const index = buildLinkIndex(pages, moduleId);

  const byPack = new Map<string, Page[]>();
  for (const p of pages) {
    const arr = byPack.get(p.pack.name);
    if (arr) arr.push(p); else byPack.set(p.pack.name, [p]);
  }

  const jsonDir = path.join(out, "_json");
  fs.rmSync(jsonDir, { recursive: true, force: true });
  for (const decl of decls) {
    const packPages = byPack.get(decl.name) ?? [];
    const { folderDocs, leafFor } = buildFolders(
      packPages.map((p) => ({ key: p, folderPath: p.foundry.folder ?? p.subfolder })),
      decl.name, decl.type, DEFAULT_STATS,
    );
    const packJsonDir = path.join(jsonDir, decl.name);
    fs.mkdirSync(packJsonDir, { recursive: true });
    for (const page of packPages) {
      const doc = assembleDoc(page, vault, index);
      doc.folder = leafFor.get(page) ?? null;
      fs.writeFileSync(path.join(packJsonDir, `${doc._id as string}.json`), JSON.stringify(doc, null, 2));
    }
    for (const f of folderDocs) {
      fs.writeFileSync(path.join(packJsonDir, `${f._id}.json`), JSON.stringify(f, null, 2));
    }
    console.log(`  ${decl.name}: ${packPages.length} documents, ${folderDocs.length} folders`);
  }

  // Compile LevelDB packs into <out>/packs/.
  const packsDir = path.join(out, "packs");
  fs.rmSync(packsDir, { recursive: true, force: true });
  fs.mkdirSync(packsDir, { recursive: true });
  console.log();
  compilePacks(jsonDir, packsDir, moduleId);
  fs.rmSync(jsonDir, { recursive: true, force: true });

  // Merge: rewrite only the packs array, preserve every other module.json key.
  manifest.packs = buildPacksArray(decls, systemId(manifest));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(outModuleJson, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nModule written to ${out}`);
}

main();
