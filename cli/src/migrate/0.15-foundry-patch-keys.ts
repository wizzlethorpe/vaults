// Migration: the foundry block's keys say what they are.
//
//   foundry.base       →  foundry.source
//   foundry.data       →  foundry.patch
//   foundry.data_json  →  foundry.patch_json
//
// `base` and `data` described where the values came from rather than what
// they do. A graft entry is a source plus a patch against it, and the
// frontmatter now uses those words, so a page and the entry it compiles into
// are read in the same vocabulary.
//
// This rewrites lines rather than round-tripping the YAML. A `foundry:` block
// is hand-written and commented — the reason a displayName is 30 lives right
// above it — and re-emitting the parsed tree would drop every one of those
// comments. So the change is exactly three key names, at one indent level,
// inside one block, and every other byte of the file is left alone.

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
  const { lines, end } = fm;
  let changed = false;

  for (const { i, line } of foundryChildren(lines)) {
    const match = /^(\s*)([A-Za-z_][\w-]*)(\s*:)/.exec(line);
    const key = match?.[2];
    if (!key || !(key in RENAMES)) continue;
    lines[i] = `${match![1]}${RENAMES[key]}${match![3]}${line.slice(match![0].length)}`;
    changed = true;
  }

  return changed ? withFrontmatter(text, lines, end) : null;
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
