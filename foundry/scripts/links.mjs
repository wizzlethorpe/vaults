// Post-processing for vault-rendered article HTML before it lands in a
// Foundry journal. Two rewrites happen here:
//   - <a class="internal-link" href="/Characters/Foo">label</a>
//       → @UUID[JournalEntry.<id>]{label}    so cross-page links route
//                                            to the matching journal.
//   - <img src="/Characters/Portraits/foo.webp">
//       → <img src="<localImageUrl>">         so images load from the
//                                            world's data dir.
//
// Unresolved wikilinks (rendered with `is-unresolved`) keep their markup
// — Foundry shows them as broken-styled text.

import { entryId } from "./ids.mjs";
import { localImageUrl } from "./media.mjs";
import { IMAGE_EXT_RE } from "./parser.mjs";

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const IMG_RE = /<img\b([^>]*?)src="([^"]+)"([^>]*)>/gi;
const ATTR_HREF_RE = /\bhref="([^"]+)"/i;
const ATTR_CLASS_RE = /\bclass="([^"]+)"/i;
const TAG_RE = /<[^>]+>/g;

/**
 * Set of logical .md paths the manifest covers. Decisions on whether to
 * rewrite an `<a class="internal-link">` or leave it alone happen by
 * decoding the href back to a vault path and looking it up in this set.
 */
export function buildPathIndex(manifestFiles) {
  const paths = new Set();
  for (const f of manifestFiles) {
    if (!f.path.endsWith(".body.html")) continue;
    paths.add(f.path.replace(/\.body\.html$/i, "") + ".md");
  }
  return { paths };
}

/**
 * `/Places/Saint%20Andral&#x27;s%20Church#anchor` →
 * `Places/Saint Andral's Church.md`.
 *
 * Handles both percent-encoding (e.g. `%27`) and HTML entity encoding
 * (`&#x27;`) — the vault renderer emits attribute-safe entities in
 * hrefs, and decodeURIComponent doesn't undo those.
 */
function logicalPathFromHref(href) {
  const decoded = decodeHtmlEntities(href);
  const cleaned = decoded.replace(/^\//, "").split("#")[0];
  try { return decodeURIComponent(cleaned) + ".md"; }
  catch { return cleaned + ".md"; }
}

/**
 * Decode HTML-attribute entities into plain text. Browser does this
 * correctly via the textarea innerHTML trick — handles named entities,
 * numeric entities (decimal and hex) without us maintaining a table.
 */
function decodeHtmlEntities(s) {
  const ta = document.createElement("textarea");
  ta.innerHTML = s;
  return ta.value;
}

/**
 * Rewrite an article body so it's safe to drop into a JournalEntryPage of
 * the given vault. `index` comes from buildPathIndex().
 */
export async function transformHtmlForFoundry(vaultId, html, index) {
  html = await rewriteWikilinks(vaultId, html, index);
  html = rewriteImages(vaultId, html);
  return html;
}

async function rewriteWikilinks(vaultId, html, index) {
  const matches = [];
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    const [full, attrs, inner] = m;
    const cls = ATTR_CLASS_RE.exec(attrs)?.[1] || "";
    if (!/\binternal-link\b/.test(cls)) continue;

    const label = stripTags(inner);
    const isUnresolved = /\bis-unresolved\b/.test(cls);
    const href = ATTR_HREF_RE.exec(attrs)?.[1] || "";
    const path = href.startsWith("/") ? logicalPathFromHref(href) : null;
    const inIndex = path != null && index.paths.has(path);

    if (isUnresolved || !inIndex) {
      // Target isn't in this variant's manifest — could be vault-author
      // typo, an Obsidian convention we don't support, or (most often) a
      // page redacted by role filtering. Render the label as styled-broken
      // text rather than leaving an inert <a> that Foundry treats as an
      // external link.
      matches.push({ idx: m.index, length: full.length, kind: "broken", label });
      continue;
    }

    matches.push({ idx: m.index, length: full.length, kind: "uuid", label, path });
  }

  // Resolve journal IDs in parallel for the resolvable matches only.
  const uuidMatches = matches.filter((r) => r.kind === "uuid");
  const ids = await Promise.all(uuidMatches.map((r) => entryId(vaultId, r.path)));
  uuidMatches.forEach((r, i) => { r.id = ids[i]; });

  // Splice from the end so earlier indices stay valid.
  matches.sort((a, b) => b.idx - a.idx);
  for (const r of matches) {
    const replacement = r.kind === "uuid"
      ? `@UUID[JournalEntry.${r.id}]{${escapeBraces(r.label)}}`
      : `<span class="vaults-broken">${escapeHtml(r.label)}</span>`;
    html = html.slice(0, r.idx) + replacement + html.slice(r.idx + r.length);
  }
  return html;
}

function rewriteImages(vaultId, html) {
  return html.replace(IMG_RE, (full, before, src, after) => {
    if (!src.startsWith("/")) return full;
    const path = decodeURIComponent(src.replace(/^\//, ""));
    if (!IMAGE_EXT_RE.test(path)) return full;
    return `<img${before}src="${escapeAttr(localImageUrl(vaultId, path))}"${after}>`;
  });
}

function stripTags(s) { return s.replace(TAG_RE, "").trim(); }
function escapeBraces(s) { return s.replace(/[{}]/g, ""); }
function escapeAttr(s) { return String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
