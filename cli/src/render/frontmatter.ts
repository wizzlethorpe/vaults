// Frontmatter helpers shared across the rendering pipeline.
//
// Today: just the `stripFrontmatter` regex used by both the embed plugin
// (transcluding ![[Page]] without re-injecting the source's YAML header) and
// the preview builder (so hover-popover snippets show body content, not
// metadata). Kept tiny and self-contained — anything richer (parsing,
// validation) belongs in build.ts where the gray-matter pipeline already
// lives.

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Remove a leading `---\n…\n---\n` block from the given markdown source.
 * Returns the input unchanged if the source has no frontmatter block.
 */
export function stripFrontmatter(source: string): string {
  return source.replace(FRONTMATTER_RE, "");
}
