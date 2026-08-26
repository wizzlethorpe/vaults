// Everything the CLI knows about the `foundry:` frontmatter block.
//
// Kept in one file because this is a shared contract, not a private detail:
// foundry/scripts/ reads exactly these keys back out of the manifest, and the
// two sides disagreeing is how `base: actor:npc` once created an Actor while
// every inbound wikilink addressed a nonexistent "actor". The doc-type rule
// here is held to foundry/scripts/foundry-base.mjs by
// cli/test/foundry-base-conformance.test.ts.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageMeta } from "./render/types.js";
import type { BodyMeta } from "./manifest.js";

/**
 * Whether a `foundry.base` will actually produce a document.
 *
 * Both forms do, for every type vaults can instantiate. This used to be
 * narrower — the module cloned from a UUID only for Actor and Item, so a lone
 * `Compendium.<pkg>.<pack>.Scene.<id>` created nothing and warning about a
 * collision would have described documents that never exist. That restriction
 * is gone (map packs ship their content as compendium Scenes, and those were
 * all being skipped), so a well-formed base always produces a document and
 * the only question left is whether the type is one we recognise.
 *
 * All entries name the same type by the time this runs, so `docType` answers
 * for the whole list.
 */
function willInstantiate(_specs: string[], docType: string): boolean {
  return canonicalFoundryType(docType) !== null;
}

export function warnFoundryDocCollisions(pages: PageMeta[]): void {
  const seen = new Map<string, string>(); // key → first page path
  for (const p of pages) {
    const fo = p.frontmatter?.["foundry"];
    if (!fo || typeof fo !== "object" || Array.isArray(fo)) continue;
    const base = (fo as Record<string, unknown>)["base"];
    const specs = (Array.isArray(base) ? base : [base])
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (specs.length === 0) continue;
    const docType = foundryBaseDocName(specs[0]!);
    if (!docType) continue;
    if (!willInstantiate(specs, docType)) continue;

    const override = (fo as Record<string, unknown>)["folder"];
    const folder = typeof override === "string" && override.trim()
      ? override.trim().replace(/^\/+|\/+$/g, "")
      : p.path.split("/").slice(0, -1).join("/");
    const name = p.title || p.path.split("/").pop()!.replace(/\.md$/i, "");

    const key = `${docType}\u0000${folder}\u0000${name}`;
    const previous = seen.get(key);
    if (previous === undefined) {
      seen.set(key, p.path);
      continue;
    }
    console.warn(
      `  ${p.path}: would create a ${docType} named '${name}' in the same Foundry `
      + `folder ('${folder || "(vault root)"}') as '${previous}'. Rename one, or `
      + `separate them with foundry.folder.`,
    );
  }
}

/**
 * The document type a `foundry.base` spec names, read off the string without
 * resolving anything. Every UUID form puts the type second-to-last
 * (`Actor.<id>`, `Compendium.<pkg>.<pack>.Actor.<id>`), and a blank-doc spec
 * (`Actor:npc`) carries it outright. `links.mjs` derives it the same way, so
 * both sides agree on where a wikilink to the page points.
 */
export function foundryBaseDocName(spec: string): string | null {
  if (spec.includes(".")) {
    const parts = spec.split(".");
    if (parts.length < 2) return null;
    const raw = parts[parts.length - 2];
    // Unknown types pass through: vaults can't instantiate a Combat, but
    // Foundry may still resolve the UUID, and reporting the type beats
    // claiming the spec names none.
    return canonicalFoundryType(raw) ?? raw ?? null;
  }
  // Blank-document form. An unrecognised type is not a base at all, so it is
  // rejected rather than passed through — matching the Foundry module, which
  // would create nothing for it.
  return canonicalFoundryType(spec.split(":")[0]);
}

/**
 * Fold a type segment to its canonical spelling, or null if vaults doesn't
 * instantiate it.
 *
 * Case matters downstream and is hand-typed here: `base: actor:npc` is
 * supported, but Foundry's `@UUID[...]` enricher does a case-sensitive
 * lookup. Returning "actor" made the CLI treat it as a different type from
 * "Actor" — so a list mixing the two failed the same-type check and had its
 * whole foundry.base dropped. Kept in step with
 * foundry/scripts/foundry-base.mjs by cli/test/foundry-base-conformance.test.ts.
 */
function canonicalFoundryType(raw: string | undefined): string | null {
  if (!raw) return null;
  return FOUNDRY_BLANK_DOC_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase()) ?? null;
}

const FOUNDRY_BLANK_DOC_TYPES = [
  "Actor", "Item", "Scene", "JournalEntry",
  "RollTable", "Macro", "Cards", "Playlist",
];

/**
 * Validate `foundry.base` and normalize it for the manifest: a single string
 * stays a string (so an older Foundry module keeps working), a list of two or
 * more stays a list. Returns null when the value can't be used, having said
 * why — the build continues, and the page syncs as a journal with no document.
 *
 * Every entry must name the same document type. The module reads that type
 * off the spec rather than off a resolved template, and `links.mjs` has to
 * reach the same answer with no lookup at all, so a list that disagrees with
 * itself has no single answer to give.
 */
function normalizeFoundryBase(base: unknown, pagePath: string): string | string[] | null {
  const raw = Array.isArray(base) ? base : [base];
  const specs: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      console.warn(
        `  ${pagePath}: foundry.base entries must be non-empty strings (a UUID like `
        + `"Compendium.<pkg>.<pack>.Actor.<id>", or a type like "Actor:npc"); `
        + `got ${entry === null ? "null" : typeof entry}. Ignoring foundry.base — this page `
        + `will sync as a journal but create no document.`,
      );
      return null;
    }
    specs.push(entry.trim());
  }
  if (specs.length === 0) {
    console.warn(`  ${pagePath}: foundry.base is an empty list; ignoring.`);
    return null;
  }

  const types = new Map<string, string>(); // docName → first spec that named it
  for (const spec of specs) {
    const docName = foundryBaseDocName(spec);
    if (!docName) {
      console.warn(`  ${pagePath}: foundry.base entry "${spec}" names no document type; ignoring foundry.base.`);
      return null;
    }
    if (!types.has(docName)) types.set(docName, spec);
  }
  if (types.size > 1) {
    const detail = [...types].map(([t, spec]) => `${t} (from "${spec}")`).join(", ");
    console.warn(
      `  ${pagePath}: every foundry.base entry must name the same document type, got ${detail}. `
      + `Ignoring foundry.base — this page will sync as a journal but create no document.`,
    );
    return null;
  }

  // A list whose last entry is a UUID can still fail on a world that lacks
  // every package named. A blank-doc tail is what makes the chain total.
  const last = specs[specs.length - 1]!;
  if (specs.length > 1 && last.includes(".")) {
    console.warn(
      `  ${pagePath}: foundry.base list ends with "${last}", so it can still resolve to nothing. `
      + `End with a blank-document entry (e.g. "${[...types.keys()][0]}:npc" or "${[...types.keys()][0]}") `
      + `to guarantee a document.`,
    );
  }

  return specs.length === 1 ? specs[0]! : specs;
}

export async function collectBodyMeta(p: PageMeta, vaultPath: string): Promise<BodyMeta> {
  const fm = p.frontmatter ?? {};
  const out: BodyMeta = { role: p.role };

  const basename = p.path.split("/").pop()!.replace(/\.md$/i, "");
  if (p.title && p.title !== basename) out.title = p.title;

  const fo = fm["foundry"];
  if (fo && typeof fo === "object" && !Array.isArray(fo)) {
    const block: Record<string, unknown> = {};
    // `base` is one spec, or a priority list the module tries in order so a
    // vault degrades across worlds with different content installed. A
    // malformed base is dropped with a warning rather than failing the build,
    // same as foundry.id below. Silence here is worse than it looks: the
    // module never receives the key, so it can't report the page either, and
    // the page syncs as a journal with no Actor/Item and no explanation.
    const base = (fo as Record<string, unknown>)["base"];
    if (base !== undefined && base !== null) {
      const normalized = normalizeFoundryBase(base, p.path);
      if (normalized !== null) block.base = normalized;
    }
    const embed = (fo as Record<string, unknown>)["embed"];
    if (typeof embed === "boolean") block.embed = embed;
    // foundry.sync: false keeps the page out of Foundry altogether — no
    // JournalEntryPage, no derived doc. The page still renders on the wiki.
    // Unlike `embed`, which only suppresses the article inside a derived
    // doc's description, this drops the page from the sync set entirely.
    const sync = (fo as Record<string, unknown>)["sync"];
    if (typeof sync === "boolean") block.sync = sync;
    // foundry.journal: false makes the derived doc without the JournalEntryPage
    // that normally accompanies it. For a page that exists to carry a Scene or
    // an Actor and has no article worth reading in the sidebar.
    const journal = (fo as Record<string, unknown>)["journal"];
    if (typeof journal === "boolean") block.journal = journal;
    // foundry.link: "doc" makes wikilinks to this page resolve to the document
    // it instantiates rather than to its journal page. Implied by
    // `journal: false`, where there is no journal page to link to.
    const link = (fo as Record<string, unknown>)["link"];
    if (link === "doc" || link === "journal") block.link = link;
    const data = (fo as Record<string, unknown>)["data"];
    if (data && typeof data === "object" && !Array.isArray(data)) block.data = data;
    // foundry.folder: a "/"-separated folder path the instantiated doc is
    // filed under, nested inside the vault's own sidebar folder. Absent
    // means the vault folder itself, which is where everything used to land.
    const folder = (fo as Record<string, unknown>)["folder"];
    if (typeof folder === "string" && folder.trim().length > 0) block.folder = folder.trim();
    // foundry.id: an explicit Foundry document id for this page. When set,
    // overrides the SHA1-derived id used for both the JournalEntryPage and
    // (if foundry.base is present) the instantiated derived doc. Lets users
    // hardcode UUIDs that other Foundry-side code (macros, scene flags,
    // module integrations) needs to reference. Foundry ids are 16 chars from
    // [A-Za-z0-9]; a malformed value is dropped with a warning rather than
    // failing the build.
    const idVal = (fo as Record<string, unknown>)["id"];
    if (typeof idVal === "string") {
      const trimmed = idVal.trim();
      if (FOUNDRY_ID_RE.test(trimmed)) block.id = trimmed;
      else if (trimmed.length > 0) {
        console.warn(`  ${p.path}: foundry.id "${trimmed}" is not a valid Foundry id (16 chars [A-Za-z0-9]); ignoring`);
      }
    }
    // foundry.data_json: vault-relative path to a JSON file. Read + parse
    // at build time and inline into the meta as `data_json`. The Foundry
    // module deep-merges it onto the base doc BEFORE foundry.data, so a
    // user can layer hand-tuned overrides on top of an exported sheet.
    // Folding the parsed object into meta means the body-row hash already
    // changes when the JSON content does — no separate change-detection.
    const dataJsonPath = (fo as Record<string, unknown>)["data_json"];
    if (typeof dataJsonPath === "string" && dataJsonPath.trim().length > 0) {
      const parsed = await loadDataJson(vaultPath, dataJsonPath.trim(), p.path);
      if (parsed !== null) block.data_json = parsed;
    }
    if (Object.keys(block).length > 0) out.foundry = block;
  }

  if (p.coverImage) out.image = p.coverImage;

  return out;
}

/** Read + parse a vault-relative JSON file referenced by `foundry.data_json`.
 *  Warns on missing / unparseable file and returns null so the page renders
 *  without the overlay rather than failing the build. */
export async function loadDataJson(
  vaultPath: string,
  relPath: string,
  pagePath: string,
): Promise<unknown | null> {
  const abs = join(vaultPath, relPath);
  try {
    const raw = await readFile(abs, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.warn(`  ${pagePath}: foundry.data_json "${relPath}" not found, skipping`);
    } else {
      console.warn(`  ${pagePath}: foundry.data_json "${relPath}" failed to parse: ${(err as Error).message}`);
    }
    return null;
  }
}

/** Foundry document ids: exactly 16 chars from [A-Za-z0-9]. Validated when
 *  authors set `foundry.id` to override the SHA1-derived default. */
const FOUNDRY_ID_RE = /^[A-Za-z0-9]{16}$/;
