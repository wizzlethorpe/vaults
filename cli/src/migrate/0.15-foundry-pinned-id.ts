// Migration: foundry.id → foundry.patch._id, where the emitter reads it.
// Line-based rather than a YAML round trip, which would drop every
// hand-written comment in the block.

import { readFile, writeFile } from "node:fs/promises";
import type { Migration } from "./types.js";
import { listMarkdownFiles, frontmatter, withFrontmatter, foundryChildren } from "./files.js";

/** Rewrite one file's frontmatter, or return null if it has nothing to move. */
export function movePinnedId(text: string): string | null {
  const fm = frontmatter(text);
  if (!fm) return null;
  const { lines, start, end } = fm;
  let childIndent: number | null = null;
  let idAt: number | null = null;
  let patchAt: number | null = null;
  let value = "";

  for (const { i, line } of foundryChildren(lines)) {
    if (childIndent === null) childIndent = line.length - line.trimStart().length;
    const id = /^\s*id:\s*(.+?)\s*$/.exec(line);
    if (id) { idAt = i; value = id[1]!; continue; }
    // An inline `patch: {…}` has no lines to insert between. Rare, and
    // rewriting it would mean parsing the flow mapping; left alone.
    if (/^\s*patch:\s*$/.test(line)) patchAt = i;
    else if (/^\s*patch:\s*\S/.test(line)) return null;
  }

  if (idAt === null || childIndent === null) return null;
  const pad = " ".repeat(childIndent);

  if (patchAt === null) {
    lines[idAt] = `${pad}patch:\n${pad}  _id: ${value}`;
  } else {
    lines.splice(idAt, 1);
    const at = patchAt > idAt ? patchAt - 1 : patchAt;
    // Match whatever indent the block already uses for its own children.
    const next = lines[at + 1];
    const inner = next && next.trim() && !next.trimStart().startsWith("#")
      ? next.length - next.trimStart().length
      : childIndent + 2;
    lines.splice(at + 1, 0, `${" ".repeat(inner)}_id: ${value}`);
  }

  return withFrontmatter(text, lines, start, end);
}

export const foundryPinnedIdMigration: Migration = {
  id: "0.15-foundry-pinned-id",
  description: "foundry.id → foundry.patch._id",

  async needs(vaultPath: string): Promise<boolean> {
    for (const file of await listMarkdownFiles(vaultPath)) {
      if (movePinnedId(await readFile(file, "utf8")) !== null) return true;
    }
    return false;
  },

  async apply(vaultPath: string): Promise<void> {
    for (const file of await listMarkdownFiles(vaultPath)) {
      const next = movePinnedId(await readFile(file, "utf8"));
      if (next !== null) await writeFile(file, next);
    }
  },
};
