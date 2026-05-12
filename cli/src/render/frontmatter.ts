// Small markdown helpers shared across the rendering pipeline. Anything
// richer (parsing, validation) belongs in build.ts where the gray-matter
// pipeline already lives.

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Remove a leading `---\n…\n---\n` block from the given markdown source.
 * Returns the input unchanged if the source has no frontmatter block.
 */
export function stripFrontmatter(source: string): string {
  return source.replace(FRONTMATTER_RE, "");
}

/** Pull the text of the first level-1 heading out of a markdown source. */
export function extractH1(source: string): string | null {
  const m = /^#\s+(.+)$/m.exec(source);
  return m?.[1] ? m[1].trim() : null;
}
