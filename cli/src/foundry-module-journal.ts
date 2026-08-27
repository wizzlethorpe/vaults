// Build a module's JournalEntry pack from the pages the wiki already rendered.
//
// Mirrors the sync model exactly: one JournalEntry per vault directory, every
// .md file in that directory an embedded JournalEntryPage. Matching it is the
// point — a document's description embeds a journal page, and if the module
// laid its journals out differently, the same vault would produce two
// different-shaped things depending on how a reader got it.
//
// The HTML is the wiki's own rendered body, not a second rendering of the
// markdown. That matters: a page's battlemap, statblock and `fm:` values only
// exist in the rendered output, so re-rendering the source with a plain
// markdown parser would quietly ship a different article than the one on the
// site.

import { createHash } from "node:crypto";

/** The sync path's id scheme, namespaced to the module instead of the vault. */
function det(kind: string, key: string): string {
  return createHash("sha1").update(`vaults:${kind}:${key}`).digest("hex").slice(0, 16);
}

export function folderOfPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** One entry per directory, so every page in a folder shares an id. */
export const journalEntryId = (ns: string, path: string): string => det("entry", `${ns}:${folderOfPath(path)}`);
export const journalPageId = (ns: string, path: string): string => det("page", `${ns}:${path}`);

export interface JournalSource {
  path: string;
  title: string;
  /** Rendered body HTML, as served to the wiki and to the sync client. */
  html: string;
}

export interface JournalTarget {
  /** Compendium UUID of the page, for @Embed and @UUID references. */
  uuid: string;
  entryId: string;
  pageId: string;
}

/**
 * Rewrite the wiki's HTML into something a Foundry journal can render.
 *
 * Two things have to change and the rest is already fine. An internal link is
 * a site path that means nothing inside Foundry, so it becomes a `@UUID`
 * enricher pointing at the compendium page. A media src is a deploy-absolute
 * path, so it becomes a module-relative one and the file is bundled.
 *
 * Deliberately narrower than the sync path's transform, which also converts
 * role-gated callouts into Foundry secret blocks. A module carries only one
 * role's pages, so there is no gated content inside them to convert.
 */
export function transformForModule(
  html: string,
  moduleId: string,
  targets: Map<string, JournalTarget>,
  assets: Set<string>,
): string {
  // An internal link the renderer marked. Attribute order is not fixed — the
  // renderer emits `class` before `href` in some cases and after in others —
  // so match the whole tag and read the attributes out of it rather than
  // assuming a shape. Anchoring on `href` first silently missed every link
  // that happened to be written the other way round.
  let out = html.replace(
    /<a\s+([^>]*)>([\s\S]*?)<\/a>/g,
    (whole, attrs: string, label: string) => {
      if (!/\bclass="[^"]*\binternal\b/.test(attrs)) return whole;
      const href = /href="([^"]*)"/.exec(attrs)?.[1];
      if (!href || !href.startsWith("/")) return whole;
      const key = decodeURIComponent(href.replace(/^\//, "").split("#")[0] ?? "");
      const target = targets.get(key) ?? targets.get(`${key}.md`);
      if (!target) return label; // page not in the module: keep the words, drop the dead link
      // Strip tags from the label: an enricher's {…} is plain text.
      const text = label.replace(/<[^>]+>/g, "").trim();
      return `@UUID[${target.uuid}]{${text}}`;
    },
  );

  // src="/attachments/x.webp" — deploy-absolute, meaningless in a module.
  out = out.replace(/(\ssrc=")\/([^"]+)"/g, (_whole, prefix: string, path: string) => {
    const rel = decodeURIComponent(path);
    assets.add(rel);
    return `${prefix}modules/${moduleId}/assets/${rel}"`;
  });
  return out;
}

export interface JournalEntryDoc {
  _id: string;
  name: string;
  pages: Array<Record<string, unknown>>;
  folder: string | null;
  sort: number;
  flags: Record<string, unknown>;
  ownership: { default: number };
  _stats: unknown;
  _key: string;
}

/**
 * Group pages into one JournalEntry per directory.
 *
 * The entry's name is the directory's own name, and a root-level page lands in
 * an entry named for the module — the same shape the sync path produces, where
 * a directory becomes an entry and its files become that entry's pages.
 */
export function buildJournalEntries(
  sources: JournalSource[],
  ns: string,
  rootName: string,
  stats: unknown,
): JournalEntryDoc[] {
  const byFolder = new Map<string, JournalSource[]>();
  for (const s of sources) {
    const folder = folderOfPath(s.path);
    const list = byFolder.get(folder) ?? [];
    list.push(s);
    byFolder.set(folder, list);
  }

  const entries: JournalEntryDoc[] = [];
  for (const [folder, pages] of [...byFolder].sort(([a], [b]) => a.localeCompare(b))) {
    const id = journalEntryId(ns, pages[0]!.path);
    entries.push({
      _id: id,
      name: folder ? folder.split("/").pop()! : rootName,
      pages: pages.map((p, i) => {
        const pid = journalPageId(ns, p.path);
        return {
          _id: pid,
          name: p.title,
          type: "text",
          title: { show: true, level: 1 },
          text: { format: 1, content: p.html },
          sort: (i + 1) * 100000,
          ownership: { default: -1 },
          flags: {},
          _stats: stats,
          _key: `!journal.pages!${id}.${pid}`,
        };
      }),
      folder: null,
      sort: 0,
      flags: {},
      ownership: { default: 0 },
      _stats: stats,
      _key: `!journal!${id}`,
    });
  }
  return entries;
}
