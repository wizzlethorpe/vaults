// Build Foundry `!folders!` documents for a compendium pack from each page's
// folder path. A path is `foundry.folder` frontmatter (override) or the page's
// subfolder location under Compendium/<pack>/, split on "/" into nested
// folders. `fvtt package pack` turns these keys into real compendium folders.

import crypto from "node:crypto";

export interface FolderDoc {
  _id: string;
  name: string;
  type: string;
  folder: string | null;
  sort: number;
  color: null;
  sorting: string;
  flags: Record<string, unknown>;
  _stats: unknown;
  _key: string;
}

/** Deterministic 16-char [A-Za-z0-9] id for a folder at a given path. */
function folderId(packName: string, pathStr: string): string {
  return crypto.createHash("sha1").update(`folder:${packName}:${pathStr}`).digest("base64")
    .replace(/[^A-Za-z0-9]/g, "").slice(0, 16).padEnd(16, "0");
}

/**
 * Build the folder docs for a pack and a map from each entry's key to its leaf
 * folder id (null when the entry sits at the pack root). `entries` pairs an
 * opaque key (the page object) with its slash-delimited folder path.
 */
export function buildFolders<K>(
  entries: Array<{ key: K; folderPath: string }>,
  packName: string,
  docType: string,
  stats: unknown,
): { folderDocs: FolderDoc[]; leafFor: Map<K, string | null> } {
  const docs = new Map<string, FolderDoc>(); // path → doc
  const leafFor = new Map<K, string | null>();

  const ensure = (segments: string[]): string | null => {
    let parent: string | null = null;
    let pathStr = "";
    for (const seg of segments) {
      pathStr = pathStr ? `${pathStr}/${seg}` : seg;
      if (!docs.has(pathStr)) {
        const id = folderId(packName, pathStr);
        docs.set(pathStr, {
          _id: id, name: seg, type: docType, folder: parent,
          sort: 0, color: null, sorting: "a", flags: {},
          _stats: stats, _key: `!folders!${id}`,
        });
      }
      parent = docs.get(pathStr)!._id;
    }
    return parent;
  };

  for (const e of entries) {
    const segments = e.folderPath.split("/").map((s) => s.trim()).filter(Boolean);
    leafFor.set(e.key, ensure(segments));
  }
  return { folderDocs: [...docs.values()], leafFor };
}
