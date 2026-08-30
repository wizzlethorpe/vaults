// Migration: foundry.base → source, foundry.data → patch, data_json →
// patch_json. Line-based rather than a YAML round trip, which would drop
// every hand-written comment in the block.

import { readFile, writeFile } from "node:fs/promises";
import type { Migration } from "./types.js";
import { listMarkdownFiles, frontmatter, withFrontmatter, foundryChildren } from "./files.js";

const RENAMES: Record<string, string> = {
  base: "source",
  data: "patch",
  data_json: "patch_json",
};

/**
 * Rewrite the frontmatter's `foundry:` block, or return null if untouched.
 *
 * Only at the block's own child indent: `data:` nested deeper is somebody's
 * actual document field and keeps its name.
 */
export function rewriteFoundryKeys(text: string): string | null {
  const fm = frontmatter(text);
  if (!fm) return null;
  const { lines, start, end } = fm;
  let changed = false;

  for (const { i, line } of foundryChildren(lines)) {
    const match = /^(\s*)([A-Za-z_][\w-]*)(\s*:)/.exec(line);
    const key = match?.[2];
    if (!key || !(key in RENAMES)) continue;
    lines[i] = `${match![1]}${RENAMES[key]}${match![3]}${line.slice(match![0].length)}`;
    changed = true;
  }

  return changed ? withFrontmatter(text, lines, start, end) : null;
}

export const foundryPatchKeysMigration: Migration = {
  id: "0.15-foundry-patch-keys",
  description: "foundry.base → foundry.source, foundry.data → foundry.patch",

  async needs(vaultPath: string): Promise<boolean> {
    for (const file of await listMarkdownFiles(vaultPath)) {
      if (rewriteFoundryKeys(await readFile(file, "utf8")) !== null) return true;
    }
    return false;
  },

  async apply(vaultPath: string): Promise<void> {
    for (const file of await listMarkdownFiles(vaultPath)) {
      const next = rewriteFoundryKeys(await readFile(file, "utf8"));
      if (next !== null) await writeFile(file, next);
    }
  },
};
