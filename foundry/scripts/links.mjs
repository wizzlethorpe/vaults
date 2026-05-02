// Post-processing for vault-rendered article HTML before it lands in a
// Foundry journal. Two rewrites happen here:
//   - <a class="internal-link" href="/Characters/Foo">label</a>
//       → @UUID[JournalEntry.<id>]{label}    so cross-page links route
//                                            to the matching journal.
//   - <img src="/Characters/Portraits/foo.webp">
//       → <img src="<localImageUrl>">         so images load from the
//                                            world's data dir.
//
// Unresolved wikilinks (rendered with `is-unresolved`) keep their
// markup — Foundry just shows them as broken-styled text.

import { entryId } from "./ids.mjs";
import { localImageUrl } from "./media.mjs";
import { IMAGE_EXT_RE } from "./parser.mjs";

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const IMG_RE = /<img\b([^>]*?)src="([^"]+)"([^>]*)>/gi;
const ATTR_HREF_RE = /\bhref="([^"]+)"/i;
const ATTR_CLASS_RE = /\bclass="([^"]+)"/i;
const TAG_RE = /<[^>]+>/g;

/**
 * Build a Set of href URLs that the manifest covers. Used to decide which
 * `<a class="internal-link">` instances should be rewritten to journal
 * UUIDs (resolved) vs left as-is (unresolved).
 */
export function buildPathIndex(manifestFiles) {
  const hrefs = new Set();
  for (const f of manifestFiles) {
    if (!f.path.endsWith(".body.html")) continue;
    hrefs.add(hrefFromBodyPath(f.path));
  }
  return { hrefs };
}

/** `Characters/Foo.body.html` → `/Characters/Foo` (encoded segments). */
function hrefFromBodyPath(bodyPath) {
  const stripped = bodyPath.replace(/\.body\.html$/i, "");
  return "/" + stripped.split("/").map(encodeURIComponent).join("/");
}

/** `/Characters/Foo` → logical `Characters/Foo.md` (the entryId key). */
function logicalPathFromHref(href) {
  const cleaned = href.replace(/^\//, "").split("#")[0];
  return decodeURIComponent(cleaned) + ".md";
}

/**
 * Rewrite an article body so it's safe to drop into a JournalEntryPage.
 * `index` comes from buildPathIndex().
 */
export async function transformHtmlForFoundry(html, index) {
  html = await rewriteWikilinks(html, index);
  html = rewriteImages(html);
  return html;
}

async function rewriteWikilinks(html, index) {
  const matches = [];
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    const [full, attrs, inner] = m;
    const cls = ATTR_CLASS_RE.exec(attrs)?.[1] || "";
    if (!/\binternal-link\b/.test(cls)) continue;
    if (/\bis-unresolved\b/.test(cls)) continue;

    const href = ATTR_HREF_RE.exec(attrs)?.[1];
    if (!href || !href.startsWith("/")) continue;
    const baseHref = href.split("#")[0];
    if (!index.hrefs.has(baseHref)) continue;

    matches.push({ idx: m.index, length: full.length, label: stripTags(inner), path: logicalPathFromHref(href) });
  }

  // Resolve IDs in parallel, then splice from the end so earlier indices stay valid.
  const ids = await Promise.all(matches.map((r) => entryId(r.path)));
  matches.forEach((r, i) => { r.id = ids[i]; });
  matches.sort((a, b) => b.idx - a.idx);
  for (const r of matches) {
    const replacement = `@UUID[JournalEntry.${r.id}]{${escapeBraces(r.label)}}`;
    html = html.slice(0, r.idx) + replacement + html.slice(r.idx + r.length);
  }
  return html;
}

function rewriteImages(html) {
  return html.replace(IMG_RE, (full, before, src, after) => {
    if (!src.startsWith("/")) return full;
    const path = decodeURIComponent(src.replace(/^\//, ""));
    if (!IMAGE_EXT_RE.test(path)) return full;
    return `<img${before}src="${escapeAttr(localImageUrl(path))}"${after}>`;
  });
}

function stripTags(s) { return s.replace(TAG_RE, "").trim(); }
function escapeBraces(s) { return s.replace(/[{}]/g, ""); }
function escapeAttr(s) { return String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
