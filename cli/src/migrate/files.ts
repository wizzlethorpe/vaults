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
