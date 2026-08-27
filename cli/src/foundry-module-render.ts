// Render a vault page's markdown body into Foundry-flavoured description HTML,
// and build a pack's compendium folders.
//
// Ported from the standalone vfmc compiler so `vaults build --module` can
// replace it. A vault body is Obsidian/vaults markdown; a Foundry sheet wants
// HTML with native inline rolls and Compendium @UUID cross-links.

import { createHash } from "node:crypto";
import { marked } from "marked";

/** Lowercased page name -> the Compendium UUID it compiled to. */
export interface LinkEntry {
  uuid: string;
  name: string;
}

// Fenced blocks that are wiki chrome: the Foundry sheet renders the same
// mechanics natively, so carrying the block's source into a description would
// show the reader a code listing of something already on their screen.
const HANDLER_FENCES = new Set([
  "spell-card", "item-card", "statblock", "statblock-fm", "gallery", "battlemap",
  "rolltable", "dice", "download", "foundry-manifest",
]);

function dropHandlerFences(md: string): string {
  return md.replace(/^```([\w-]+)[^\n]*\n[\s\S]*?^```[ \t]*$/gm, (block, lang: string) =>
    HANDLER_FENCES.has(lang) ? "" : block,
  );
}

/** `dice: 2d6+1` in backticks becomes dnd5e's native inline roll. */
function diceToRolls(md: string): string {
  return md.replace(/`dice:\s*([^`]+?)`/gi, (_m, f: string) => `[[/r ${f.trim()}]]`);
}

function rewriteWikilinks(md: string, index: Map<string, LinkEntry>): string {
  return md.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
    const entry = index.get(target.trim().toLowerCase());
    const text = (label ?? target).trim();
    return entry ? `@UUID[${entry.uuid}]{${text}}` : text;
  });
}

/**
 * Wikilinks are rewritten before dice, not after: at that point a `dice:` span
 * is still inside backticks, so the wikilink pass cannot mistake the `[[/r …]]`
 * this would otherwise have produced for a link of its own.
 */
export function renderBody(md: string, index: Map<string, LinkEntry>): string {
  let out = dropHandlerFences(md);
  out = rewriteWikilinks(out, index);
  out = diceToRolls(out);
  return (marked.parse(out, { async: false }) as string).trim();
}

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

function folderId(packName: string, pathStr: string): string {
  return createHash("sha1").update(`folder:${packName}:${pathStr}`).digest("base64")
    .replace(/[^A-Za-z0-9]/g, "").slice(0, 16).padEnd(16, "0");
}

/**
 * Build `!folders!` documents for a pack, plus the leaf folder each entry
 * belongs in. `fvtt package pack` turns these keys into real compendium
 * folders, so a pack of 500 items is browsable rather than one flat list.
 */
export function buildFolders<K>(
  entries: Array<{ key: K; folderPath: string }>,
  packName: string,
  docType: string,
  stats: unknown,
): { folderDocs: FolderDoc[]; leafFor: Map<K, string | null> } {
  const docs = new Map<string, FolderDoc>();
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
    leafFor.set(e.key, ensure(e.folderPath.split("/").map((s) => s.trim()).filter(Boolean)));
  }
  return { folderDocs: [...docs.values()], leafFor };
}
