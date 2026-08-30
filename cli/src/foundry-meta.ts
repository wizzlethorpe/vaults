// What the CLI knows about the `foundry:` frontmatter block: which document a
// `source` names, and whether two pages are fighting over the same one.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageMeta } from "./render/types.js";

/**
 * Whether a `foundry.source` will actually produce a document.
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
    const base = (fo as Record<string, unknown>)["source"];
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
 * The document type a `foundry.source` spec names, read off the string without
 * resolving anything. Every UUID form puts the type second-to-last
 * (`Actor.<id>`, `Compendium.<pkg>.<pack>.Actor.<id>`), and a blank-doc spec
 * (`Actor:npc`) carries it outright. `links.mjs` derives it the same way, so
 * both sides agree on where a wikilink to the page points.
 */
function foundryBaseDocName(spec: string): string | null {
  // A Moulinette reference names no type. Checked before the UUID rule
  // because its file segment ends in ".json", which the dot test would
  // otherwise read as a UUID. The type comes from another entry in the list;
  // normalizeFoundryBase makes sure one is there.
  if (spec.startsWith("@moulinette/")) return null;
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
 * whole foundry.source dropped. Kept in step with
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



/** Read + parse a vault-relative JSON file referenced by `foundry.patch_json`.
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
      console.warn(`  ${pagePath}: foundry.patch_json "${relPath}" not found, skipping`);
    } else {
      console.warn(`  ${pagePath}: foundry.patch_json "${relPath}" failed to parse: ${(err as Error).message}`);
    }
    return null;
  }
}




