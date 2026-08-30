// What the CLI knows about the `foundry:` frontmatter block: which document a
// `source` names, and whether two pages are fighting over the same one.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DOC_TYPES } from "./foundry-types.js";
import { documentTypeOf, firstBase } from "./foundry-grafts.js";
import type { PageMeta } from "./render/types.js";

export function warnFoundryDocCollisions(pages: PageMeta[]): void {
  const seen = new Map<string, string>(); // key → first page path
  for (const p of pages) {
    const fo = p.frontmatter?.["foundry"];
    if (!fo || typeof fo !== "object" || Array.isArray(fo)) continue;
    if ((fo as Record<string, unknown>)["sync"] === false) continue;
    const spec = firstBase((fo as Record<string, unknown>)["source"]);
    if (!spec) continue;
    // The same reading the emitter uses, so a warning never describes a
    // document that will not exist: a type with no pack produces nothing.
    const docType = documentTypeOf(spec);
    if (!docType || !DOC_TYPES[docType]) continue;

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

