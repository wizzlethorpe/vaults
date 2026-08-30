// Every markdown file in a vault, for migrations that rewrite page content.
//
// Skips dot-directories: `.vaults/` holds the build cache, whose rendered
// copies are regenerated from the sources a migration is busy fixing.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listMarkdownFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** A file's frontmatter as lines, with what is needed to splice it back. */
export function frontmatter(text: string): { lines: string[]; end: number } | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  return { lines: text.slice(4, end + 1).split("\n"), end };
}

/** The edited frontmatter lines spliced back into the file. */
export function withFrontmatter(text: string, lines: string[], end: number): string {
  return text.slice(0, 4) + lines.join("\n") + text.slice(end + 1);
}

/**
 * The direct children of a top-level `foundry:` block, at the block's own
 * child indent. Blank and comment lines are skipped; a deeper-nested line is
 * somebody's actual document field and never yielded. A `foundry: {}` on one
 * line opens no block, and any other top-level key closes it.
 */
export function* foundryChildren(lines: string[]): Generator<{ i: number; line: string }> {
  let inBlock = false;
  let childIndent: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (!inBlock) {
      if (indent === 0 && /^foundry:\s*$/.test(line)) inBlock = true;
      continue;
    }
    if (indent === 0) return;
    if (childIndent === null) childIndent = indent;
    if (indent === childIndent) yield { i, line };
  }
}
