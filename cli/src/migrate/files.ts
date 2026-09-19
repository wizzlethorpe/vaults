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

/**
 * A file's frontmatter as lines, with what is needed to splice it back.
 * CRLF files keep their `\r` on each line and get it back unchanged.
 */
export function frontmatter(text: string): { lines: string[]; start: number; end: number } | null {
  const open = /^---\r?\n/.exec(text);
  if (!open) return null;
  const close = /\r?\n---/.exec(text.slice(open[0].length));
  if (!close) return null;
  const start = open[0].length;
  const end = start + close.index;
  return { lines: text.slice(start, end).split("\n"), start, end };
}

/** The edited frontmatter lines spliced back into the file. */
export function withFrontmatter(text: string, lines: string[], start: number, end: number): string {
  return text.slice(0, start) + lines.join("\n") + text.slice(end);
}
