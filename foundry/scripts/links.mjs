// Wikilink + image-embed resolution.
//
// Wikilinks `[[Page]]` and `[[Page|Alias]]` resolve to the Foundry
// JournalEntry whose path matches; rendered as @UUID[…] refs that Foundry's
// TextEditor enriches into clickable journal links.
//
// Image embeds `![[image.png]]` rewrite to absolute vault URLs so Foundry
// loads images directly from the deployment.

import { entryId } from "./ids.mjs";
import { localImageUrl } from "./media.mjs";
import { slugify, IMAGE_EXT_RE } from "./parser.mjs";

/**
 * Build slug → vault-path indexes from the manifest. Three maps so we can
 * resolve every Obsidian reference shape:
 *   byBasename   slugified page basename       (`[[Aghash]]`)
 *   byPath       slugified full path           (`[[NPCs/Aghash]]`)
 *   images       slugified image basename      (`![[foo.png]]`)
 *
 * The image index is the only way to find images that live outside an
 * `attachments/` folder — vaults often scatter portraits next to the
 * pages that reference them, and the build preserves source paths.
 */
export function buildPathIndex(manifestFiles) {
  const byBasename = new Map();
  const byPath = new Map();
  const images = new Map();
  for (const f of manifestFiles) {
    if (f.path.endsWith(".md")) {
      const basename = f.path.split("/").pop().replace(/\.md$/, "");
      if (!byBasename.has(slugify(basename))) byBasename.set(slugify(basename), f.path);
      byPath.set(slugify(f.path.replace(/\.md$/, "")), f.path);
    } else if (IMAGE_EXT_RE.test(f.path)) {
      const basename = f.path.split("/").pop();
      const noExt = basename.replace(/\.[^.]+$/, "");
      // First-write-wins so an image earlier in the tree (typically the
      // canonical one) takes precedence over a duplicate basename deeper.
      if (!images.has(slugify(noExt))) images.set(slugify(noExt), f.path);
    }
  }
  return { byBasename, byPath, images };
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
  // Image embeds first (so they don't get caught by the wikilink regex).
  // Resolve the actual deployed path from the manifest — Obsidian users
  // reference images by basename, but the build preserves the vault's
  // folder structure (Characters/Portraits/foo.webp, etc).
  let out = source.replace(
    /!\[\[([^\[\]|#\n]+?)(?:\|([^\[\]#\n]*))?\]\]/g,
    (_, name, alias) => {
      if (!IMAGE_EXT_RE.test(name)) return ""; // page transclusion → drop for now
      const noExt = name.replace(/\.[^.]+$/, "");
      const realPath = index.images?.get(slugify(noExt));
      if (!realPath) {
        // Image isn't in the manifest — render a styled broken marker
        // rather than emit a guess that's just going to 404.
        return `<span class="vaults-broken">missing image: ${escapeText(name)}</span>`;
      }
      // Local Foundry path — image was downloaded into the world's data
      // dir during sync, so no token / cross-origin fetch at view time.
      const url = localImageUrl(realPath);
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
