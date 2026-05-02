// Wikilink + image-embed resolution.
//
// Wikilinks `[[Page]]` and `[[Page|Alias]]` resolve to the Foundry
// JournalEntry whose path matches; rendered as @UUID[…] refs that Foundry's
// TextEditor enriches into clickable journal links.
//
// Image embeds `![[image.png]]` rewrite to absolute vault URLs so Foundry
// loads images directly from the deployment.

import { entryId } from "./ids.mjs";
import { attachmentUrl } from "./api.mjs";
import { slugify, IMAGE_EXT_RE } from "./parser.mjs";

/**
 * Build a slug → vault-path index from the manifest's .md entries. Both
 * basename slug and full-path slug are keyed so [[Aghash]] and
 * [[NPCs/Aghash]] both resolve.
 */
export function buildPathIndex(manifestFiles) {
  const byBasename = new Map();
  const byPath = new Map();
  for (const f of manifestFiles) {
    if (!f.path.endsWith(".md")) continue;
    const basename = f.path.split("/").pop().replace(/\.md$/, "");
    if (!byBasename.has(slugify(basename))) byBasename.set(slugify(basename), f.path);
    byPath.set(slugify(f.path.replace(/\.md$/, "")), f.path);
  }
  return { byBasename, byPath };
}

/** Resolve a wikilink target name to a vault path, if the page exists. */
export function resolvePath(name, index) {
  const slug = slugify(name);
  return index.byBasename.get(slug) ?? index.byPath.get(slug) ?? null;
}

/**
 * Resolve all wikilinks and image embeds in markdown source.
 *   [[Page]]              → @UUID[JournalEntry.<id>]{Page} or italic-broken
 *   [[Page|Alias]]        → @UUID[JournalEntry.<id>]{Alias}
 *   ![[image.png]]        → ![](https://vault../attachments/image.png)
 *
 * Done at the markdown level (before render) so marked produces clean output.
 */
export async function transformLinks(source, index) {
  // Image embeds first (so they don't get caught by the wikilink regex)
  let out = source.replace(
    /!\[\[([^\[\]|#\n]+?)(?:\|([^\[\]#\n]*))?\]\]/g,
    (_, name, alias) => {
      if (!IMAGE_EXT_RE.test(name)) return ""; // page transclusion → drop for now
      // Match the build's webp output for compressible images. Plain hotlink
      // means Foundry loads from the deployment URL on render.
      const compressed = name.replace(IMAGE_EXT_RE, ".webp");
      const url = attachmentUrl(`/attachments/${compressed}`);
      const sizeAttrs = parseSize(alias);
      return `<img src="${url}" alt="${escapeAttr(name)}" loading="lazy"${sizeAttrs}>`;
    },
  );

  // Then wikilinks. Async because we need the deterministic id (which is
  // SHA-1, async). Collect matches, await ids in parallel, then splice.
  const matches = [];
  out.replace(
    /(?<!!)\[\[([^\[\]|#\n]+?)(?:#([^\[\]|#\n]+?))?(?:\|([^\[\]#\n]+?))?\]\]/g,
    (full, name, _anchor, alias, idx) => {
      matches.push({ full, name: name.trim(), alias: alias?.trim(), idx });
      return full;
    },
  );

  const replacements = await Promise.all(matches.map(async (m) => {
    const path = resolvePath(m.name, index);
    const display = m.alias ?? m.name;
    if (!path) {
      return { ...m, replacement: `<span class="vaults-broken">${escapeText(display)}</span>` };
    }
    const id = await entryId(path);
    return { ...m, replacement: `@UUID[JournalEntry.${id}]{${display}}` };
  }));

  // Splice from the end so earlier indices stay valid.
  replacements.sort((a, b) => b.idx - a.idx);
  for (const r of replacements) {
    out = out.slice(0, r.idx) + r.replacement + out.slice(r.idx + r.full.length);
  }
  return out;
}

function parseSize(alias) {
  if (!alias) return "";
  const m = /^(\d+)(?:x(\d+))?$/.exec(alias);
  if (!m) return "";
  return m[2] != null ? ` width="${m[1]}" height="${m[2]}"` : ` width="${m[1]}"`;
}

function escapeAttr(s) { return String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function escapeText(s) { return String(s).replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
