// Parsing helpers: frontmatter strip, Obsidian comment strip, wikilink/embed
// pattern matching. Mirrors the vaults-template renderer's pre-processing so
// the Foundry-side output looks like the wiki.

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(source) {
  const m = FM_RE.exec(source);
  if (!m) return { frontmatter: {}, body: source };
  const fm = parseSimpleYaml(m[1]);
  const body = source.slice(m[0].length);
  return { frontmatter: fm, body };
}

/**
 * Tiny YAML subset — handles "key: value" and arrays. Frontmatter rarely
 * needs more, and avoiding a YAML dep keeps the bundle small.
 */
function parseSimpleYaml(text) {
  const out = {};
  let currentArrayKey = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line) continue;

    if (line.startsWith("  - ") && currentArrayKey) {
      const v = line.slice(4).replace(/^["']|["']$/g, "");
      (out[currentArrayKey] ||= []).push(v);
      continue;
    }
    currentArrayKey = null;

    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (raw === "" || raw === "[]") {
      currentArrayKey = key;
      out[key] = [];
    } else {
      out[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

/** Strip Obsidian-style %% comments %% before rendering. */
export function stripComments(source) {
  return source.replace(/%%[\s\S]*?%%/g, "");
}

/** Slugify like vaults-template's render/slug.ts. */
export function slugify(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|tiff?)$/i;
