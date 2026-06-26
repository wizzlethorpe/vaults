// Build Foundry `!folders!` documents for a compendium pack from each page's
// folder path. A path is `foundry.folder` frontmatter (override) or the page's
// subfolder location under Compendium/<pack>/, split on "/" into nested
// folders. `fvtt package pack` turns these keys into real compendium folders.
import crypto from "node:crypto";
/** Deterministic 16-char [A-Za-z0-9] id for a folder at a given path. */
function folderId(packName, pathStr) {
    return crypto.createHash("sha1").update(`folder:${packName}:${pathStr}`).digest("base64")
        .replace(/[^A-Za-z0-9]/g, "").slice(0, 16).padEnd(16, "0");
}
/**
 * Build the folder docs for a pack and a map from each entry's key to its leaf
 * folder id (null when the entry sits at the pack root). `entries` pairs an
 * opaque key (the page object) with its slash-delimited folder path.
 */
export function buildFolders(entries, packName, docType, stats) {
    const docs = new Map(); // path → doc
    const leafFor = new Map();
    const ensure = (segments) => {
        let parent = null;
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
            parent = docs.get(pathStr)._id;
        }
        return parent;
    };
    for (const e of entries) {
        const segments = e.folderPath.split("/").map((s) => s.trim()).filter(Boolean);
        leafFor.set(e.key, ensure(segments));
    }
    return { folderDocs: [...docs.values()], leafFor };
}
//# sourceMappingURL=folders.js.map