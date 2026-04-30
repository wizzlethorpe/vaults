// Builds compact JSON preview blobs at build time for hover popovers.
// One file per page, served alongside the rendered .html as `<path>.preview.json`.

export interface PagePreview {
  title: string;
  summary: string;
  /** anchor → { title, summary } for first-pass section previews. */
  headings: Record<string, { title: string; summary: string }>;
}

const SUMMARY_LEN = 220;

/**
 * Extract a per-page preview: the first ~220 chars of body text, plus a
 * short summary keyed by each heading anchor for `[[Page#section]]` hovers.
 */
export function buildPreview(rawMarkdown: string, title: string): PagePreview {
  const body = stripFrontmatter(rawMarkdown).trim();
  const stripped = stripMarkdown(body);
  const summary = trimText(stripped, SUMMARY_LEN);

  const headings: Record<string, { title: string; summary: string }> = {};
  // Match headings at line start, optionally inside a blockquote/callout.
  const sectionRe = /^(?:>\s*)?(#{1,6})\s+(.+)$/gm;
  const matches = [...body.matchAll(sectionRe)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const headingTitle = m[2]!.trim();
    const start = (m.index ?? 0) + m[0]!.length;
    const next = matches[i + 1];
    const end = next ? next.index ?? body.length : body.length;
    const sectionBody = body.slice(start, end);
    const anchor = slugify(headingTitle);
    headings[anchor] = {
      title: headingTitle,
      summary: trimText(stripMarkdown(sectionBody), SUMMARY_LEN),
    };
  }

  return { title, summary, headings };
}

function stripFrontmatter(s: string): string {
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, "")               // fenced code
    .replace(/!\[\[[^\]]+\]\]/g, "")              // image embeds
    .replace(/\[\[([^\]|#]+)(?:[#|][^\]]+)?\]\]/g, "$1") // wikilinks
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")       // markdown images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")      // markdown links
    .replace(/`([^`]+)`/g, "$1")                  // inline code
    .replace(/[*_~]+([^*_~]+)[*_~]+/g, "$1")       // emphasis
    .replace(/^>\s?\[![^\]]+\][+-]?\s*(.*)$/gm, "$1") // callout markers
    .replace(/^>\s?/gm, "")                        // blockquote markers
    .replace(/^#{1,6}\s+/gm, "")                  // headings
    .replace(/\s+/g, " ")
    .trim();
}

function trimText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "…";
}

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
