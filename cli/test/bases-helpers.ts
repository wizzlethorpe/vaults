// Test helpers for the Bases plugin tests. Builds a minimal RenderContext
// that satisfies what bases.ts actually consults (pages map, frontmatter,
// optionally images + markdownContent for cover-image lookups).

import type { ImageEntry, PageMeta, RenderContext } from "../src/render/types.js";
import { slugify } from "../src/render/slug.js";

export interface PageInput {
  /** Vault-relative path including .md (e.g. "Items/Sword.md"). */
  path: string;
  /** Optional title; defaults to basename. */
  title?: string;
  /** Frontmatter for the page. Drives note.X / bare-X / formula evaluation. */
  fm?: Record<string, unknown>;
  /** Markdown body; used by the cards view's cover-image auto-detection. */
  body?: string;
  /** Unix-seconds; lets tests control file.mtime / file.ctime. */
  mtime?: number;
  birthtime?: number;
  role?: string;
}

export interface ImageInput {
  /** Vault-relative source path. */
  source: string;
  /** Output path that will be served (e.g. "Attachments/portrait.webp"). */
  output?: string;
}

/**
 * Build a RenderContext sufficient for renderBase() to evaluate filters,
 * formulas, sorts, and view rendering. The pages map is keyed by both the
 * basename slug and the path slug — same shape build.ts produces.
 */
export function mkContext(pages: PageInput[], images: ImageInput[] = []): RenderContext {
  const pageIndex = new Map<string, PageMeta>();
  const markdownContent = new Map<string, string>();
  for (const p of pages) {
    const filename = p.path.split("/").pop()!;
    const basename = filename.replace(/\.md$/i, "");
    const meta: PageMeta = {
      path: p.path,
      title: p.title ?? basename,
      role: p.role ?? "public",
      ...(p.fm && Object.keys(p.fm).length > 0 ? { frontmatter: p.fm } : {}),
      ...(p.mtime != null ? { mtime: p.mtime } : {}),
      ...(p.birthtime != null ? { birthtime: p.birthtime } : {}),
    };
    pageIndex.set(slugify(basename), meta);
    pageIndex.set(slugify(p.path.replace(/\.md$/i, "")), meta);
    if (p.body) {
      markdownContent.set(slugify(basename), p.body);
      markdownContent.set(slugify(p.path.replace(/\.md$/i, "")), p.body);
    }
  }

  const imageIndex = new Map<string, ImageEntry>();
  for (const img of images) {
    const filename = img.source.split("/").pop()!;
    imageIndex.set(slugify(filename), {
      sourcePath: img.source,
      outputPath: img.output ?? img.source,
    });
  }

  return {
    pages: pageIndex,
    images: imageIndex,
    markdownContent,
    bases: new Map(),
    defaultImageWidth: "",
    redactRoles: new Set(),
  };
}

/**
 * Count how many table rows a rendered HTML block contains. Counts only
 * data-row attributes so toolbar inputs don't trip the regex.
 */
export function countTableRows(html: string): number {
  return (html.match(/data-row="\d+"/g) ?? []).length;
}

/**
 * Pull the ordered list of titles from a rendered table view. Each <td> for
 * the title column contains an <a> with the title text.
 */
export function tableTitles(html: string): string[] {
  const rows = html.match(/<tr data-row="\d+">[\s\S]*?<\/tr>/g) ?? [];
  return rows.map((row) => {
    const m = /<a[^>]*class="internal[^"]*"[^>]*>([^<]+)<\/a>/.exec(row);
    return m?.[1] ?? "";
  });
}

/**
 * Pull the ordered list of titles from a rendered cards view.
 */
export function cardTitles(html: string): string[] {
  const titles = html.match(/<div class="bases-card-title">([^<]+)<\/div>/g) ?? [];
  return titles.map((t) => /<div class="bases-card-title">([^<]+)<\/div>/.exec(t)?.[1] ?? "");
}

/**
 * Pull the ordered list of titles from a rendered list view.
 */
export function listTitles(html: string): string[] {
  const block = /<ul class="bases-list">([\s\S]*?)<\/ul>/.exec(html);
  if (!block) return [];
  const items = block[1]!.match(/<a[^>]*>([^<]+)<\/a>/g) ?? [];
  return items.map((a) => /<a[^>]*>([^<]+)<\/a>/.exec(a)?.[1] ?? "");
}
