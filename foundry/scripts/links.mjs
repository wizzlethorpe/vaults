// Post-processing for vault-rendered article HTML before it lands in a
// Foundry journal. Three rewrites happen here:
//   - <a class="internal-link" href="/Characters/Foo">label</a>
//       → @UUID[JournalEntry.<id>]{label}    so cross-page links route
//                                            to the matching journal.
//   - <img|audio|video src="/path/to/file.ext">
//       → src="<localFileUrl>"               so media loads from the
//                                            world's per-vault cache.
//   - <a class="passthrough-link" href="/path/to/file.ext">
//       → href="<localFileUrl>"              so PDF/epub/JSON links work
//                                            inside Foundry too.
//
// Unresolved wikilinks (rendered with `is-unresolved`) keep their markup
//. Foundry shows them as broken-styled text.

import { entryId, pageId } from "./ids.mjs";
import { localFileUrl } from "./media.mjs";
import { CACHED_EXT_RE } from "./parser.mjs";
import { escapeAttr, escapeHtml, escapeBraces } from "./util.mjs";

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const MEDIA_SRC_RE = /<(img|audio|video)\b([^>]*?)src="([^"]+)"([^>]*)>/gi;
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
  // Per-page id overrides from `foundry.id` frontmatter. Used so wikilinks
  // resolve to the user-pinned id rather than the path-derived SHA1 — without
  // this, a `[[Other Page]]` link would compute the default id and miss the
  // page Foundry actually created.
  const idOverrides = new Map();
  for (const f of manifestFiles) {
    if (!f.path.endsWith(".body.html")) continue;
    const mdPath = f.path.replace(/\.body\.html$/i, "") + ".md";
    paths.add(mdPath);
    const override = f.meta?.foundry?.id;
    if (typeof override === "string" && override) idOverrides.set(mdPath, override);
  }
  return { paths, idOverrides };
}

/**
 * `/Places/Saint%20Andral&#x27;s%20Church#anchor` →
 * `Places/Saint Andral's Church.md`.
 *
 * Handles both percent-encoding (e.g. `%27`) and HTML entity encoding
 * (`&#x27;`); the vault renderer emits attribute-safe entities in
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
 * correctly via the textarea innerHTML trick; handles named entities,
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
 *
 * When the vault has a dmRole configured, role-gated callouts whose role
 * is at-or-above the dmRole get wrapped in <section class="secret">.
 * Foundry's renderer hides secret sections from non-GMs at view time, so
 * a player never sees DM callouts on a journal they otherwise can read.
 * The Actor/Item description's @Embed[…] expansion inherits the same
 * gating because it fans out through the journal's HTML — which is why
 * we wrap unconditionally, even on DM-tier pages: an embedded fragment
 * may surface inside a player-visible parent.
 */
export async function transformHtmlForFoundry(vault, html, index) {
  html = await rewriteWikilinks(vault.id, html, index);
  html = rewriteMediaSrcs(vault.id, html);
  html = rewritePassthroughLinks(vault.id, html);
  html = await applyDomTransforms(html, vault, index);
  return html;
}

/**
 * String-based passes (wikilinks, images) run first because they're
 * regex-friendly and don't fight with DOM serialization. Everything that
 * needs structural awareness — tab flattening, secret-block wrapping,
 * code-block enricher escaping, bases-card link rewrites — happens here in
 * one DOMParser round-trip so we don't pay multiple parse/serialize costs.
 */
async function applyDomTransforms(html, vault, index) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let touched = false;
  touched = stripWebOnlyWidgets(doc) || touched;
  touched = flattenBasesTabs(doc) || touched;
  touched = neutralizeEnrichersInCode(doc) || touched;
  touched = (await rewriteBasesCardLinks(doc, vault.id, index)) || touched;
  touched = rewriteDiceButtons(doc) || touched;
  touched = wrapRestrictedCalloutsAsSecret(doc, vault) || touched;
  return touched ? doc.body.innerHTML : html;
}

// Handler widgets that only make sense on the static wiki and should not be
// carried into a Foundry journal. The `battlemap` viewer is interactive,
// JS-driven, and redundant in Foundry (the real Scene is imported separately),
// so its runtime never loads there — leaving it in would just render dead
// markup. The surrounding heading/prose is left intact; only the widget goes.
const WEB_ONLY_WIDGET_SELECTOR = ".vaults-battlemap";

/** Remove web-only handler widgets from an article before it becomes a
 *  JournalEntryPage. Returns true if anything was removed. */
function stripWebOnlyWidgets(doc) {
  const widgets = doc.querySelectorAll(WEB_ONLY_WIDGET_SELECTOR);
  for (const el of widgets) el.remove();
  return widgets.length > 0;
}

/**
 * Rewrite `dice:` handler output into Foundry's native inline-roll
 * enricher syntax. The CLI ships dice as `<button class="dice-roll"
 * data-formula="X">X</button>`, with its own click-to-roll JS runtime
 * for the static wiki. In Foundry that runtime isn't loaded; instead,
 * Foundry's text enricher converts `[[/r X]]` into a real, clickable
 * roll with chat output, dice-so-nice integration, and modifier menus.
 *
 * The invalid-formula fallback (`<code class="dice-roll-invalid">`) is
 * left alone — the formula is malformed and we don't want Foundry's
 * enricher to throw on it either.
 */
function rewriteDiceButtons(doc) {
  const buttons = doc.querySelectorAll("button.dice-roll[data-formula]");
  if (buttons.length === 0) return false;
  for (const btn of buttons) {
    const formula = btn.getAttribute("data-formula");
    if (!formula) continue;
    btn.replaceWith(doc.createTextNode(`[[/r ${formula}]]`));
  }
  return true;
}

/**
 * Multi-view bases render as a tabbed container in the wiki. In a static
 * journal page the tab JS isn't wired, so the inactive panels would be
 * `hidden` forever. Flatten the structure: drop the tab strip, unwrap
 * each panel's contents into the parent so all views render in sequence.
 * Each .bases-block keeps its own .bases-caption (CSS hides them in the
 * wiki tabbed view; Foundry doesn't load that rule, so they show as
 * natural section headers).
 */
function flattenBasesTabs(doc) {
  const tabbeds = doc.querySelectorAll(".bases-tabbed");
  if (tabbeds.length === 0) return false;
  for (const tabbed of tabbeds) {
    const fragment = doc.createDocumentFragment();
    for (const panel of tabbed.querySelectorAll(".bases-tab-panel")) {
      panel.removeAttribute("hidden");
      while (panel.firstChild) fragment.appendChild(panel.firstChild);
    }
    tabbed.replaceWith(fragment);
  }
  return true;
}

/**
 * Foundry walks ALL text nodes during enrichment, including those inside
 * <code> and <pre>. A user writing `@Embed[…]` as documentation example
 * inside an inline-code span gets the enricher firing on the literal text
 * and reporting "Failed to embed content from 'undefined'.". Inserting a
 * zero-width space after `@` in code contexts breaks the regex without
 * being visible. Copy-paste sees the ZWS but readers don't.
 */
function neutralizeEnrichersInCode(doc) {
  const codes = doc.querySelectorAll("code, pre");
  if (codes.length === 0) return false;
  const ZWS = "​"; // U+200B zero-width space
  let touched = false;
  for (const el of codes) {
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const orig = node.nodeValue;
      if (orig.indexOf("@") < 0) continue;
      const next = orig.replace(/@/g, "@" + ZWS);
      if (next !== orig) { node.nodeValue = next; touched = true; }
    }
  }
  return touched;
}

/**
 * Bases card anchors render as `<a class="bases-card" href="/Foo">…</a>`
 * with rich content (cover image + body) inside. The plain wikilink
 * rewriter can't touch them because it converts <a internal-link> into
 * an `@UUID[…]{label}` text enricher, which would discard the rich
 * content. Instead we add `content-link` + `data-uuid` so Foundry's
 * journal-page click handler routes to the linked JournalEntry while the
 * card structure stays intact.
 */
async function rewriteBasesCardLinks(doc, vaultId, index) {
  const cards = doc.querySelectorAll("a.bases-card[href]");
  if (cards.length === 0) return false;
  let touched = false;
  for (const a of cards) {
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("/")) continue;
    const path = logicalPathFromHref(href);
    if (!index.paths.has(path)) continue;
    const eId = await entryId(vaultId, path);
    const pId = index.idOverrides?.get(path) ?? await pageId(vaultId, path);
    a.classList.add("content-link");
    a.setAttribute("data-uuid", `JournalEntry.${eId}.JournalEntryPage.${pId}`);
    a.removeAttribute("href"); // Foundry triggers off the data-uuid; an href would re-navigate the page.
    touched = true;
  }
  return touched;
}

function wrapRestrictedCalloutsAsSecret(doc, vault) {
  if (!vault?.dmRole || !Array.isArray(vault.knownRoles) || vault.knownRoles.length === 0) {
    return false;
  }
  const dmIdx = vault.knownRoles.indexOf(vault.dmRole);
  if (dmIdx < 0) return false;

  const restrictedRoles = vault.knownRoles.slice(dmIdx);
  if (restrictedRoles.length === 0) return false;

  let touched = false;
  for (const role of restrictedRoles) {
    for (const el of doc.querySelectorAll(".callout.callout-" + cssEscape(role))) {
      const section = doc.createElement("section");
      section.className = "secret";
      el.parentNode.insertBefore(section, el);
      section.appendChild(el);
      touched = true;
    }
  }
  return touched;
}

// CSS.escape isn't available in every Foundry runtime; keep this small
// enough to handle the role names users actually configure (alphanumerics
// plus _-).
function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
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
      // Target isn't in this variant's manifest; could be vault-author
      // typo, an Obsidian convention we don't support, or (most often) a
      // page redacted by role filtering. Render the label as styled-broken
      // text rather than leaving an inert <a> that Foundry treats as an
      // external link.
      matches.push({ idx: m.index, length: full.length, kind: "broken", label });
      continue;
    }

    matches.push({ idx: m.index, length: full.length, kind: "uuid", label, path });
  }

  // Resolve entry + page IDs in parallel for the resolvable matches. Pages
  // are addressed as `JournalEntry.<eId>.JournalEntryPage.<pId>` so a click
  // opens the specific page rather than the entry's first page.
  const uuidMatches = matches.filter((r) => r.kind === "uuid");
  const resolved = await Promise.all(uuidMatches.map(async (r) => ({
    eId: await entryId(vaultId, r.path),
    pId: index.idOverrides?.get(r.path) ?? await pageId(vaultId, r.path),
  })));
  uuidMatches.forEach((r, i) => { r.eId = resolved[i].eId; r.pId = resolved[i].pId; });

  // Splice from the end so earlier indices stay valid.
  matches.sort((a, b) => b.idx - a.idx);
  for (const r of matches) {
    const replacement = r.kind === "uuid"
      ? `@UUID[JournalEntry.${r.eId}.JournalEntryPage.${r.pId}]{${escapeBraces(r.label)}}`
      : `<span class="vaults-broken">${escapeHtml(r.label)}</span>`;
    html = html.slice(0, r.idx) + replacement + html.slice(r.idx + r.length);
  }
  return html;
}

/** Rewrite local /path src attrs on <img>, <audio>, <video> to the local
 *  per-vault cache URL. Anything pointing at an external URL or a path
 *  with an extension we don't cache is left alone — Foundry will treat
 *  those as external (which they are). */
function rewriteMediaSrcs(vaultId, html) {
  return html.replace(MEDIA_SRC_RE, (full, tag, before, src, after) => {
    if (!src.startsWith("/")) return full;
    const path = decodeURIComponent(src.replace(/^\//, ""));
    if (!CACHED_EXT_RE.test(path)) return full;
    return `<${tag}${before}src="${escapeAttr(localFileUrl(vaultId, path))}"${after}>`;
  });
}

/** Rewrite the href on `<a class="passthrough-link" href="/...">` (the
 *  emitter for `![[doc.pdf]]`-style passthrough embeds) to point at the
 *  local cache. Class-gated so we don't accidentally rewrite genuine
 *  external links the author intended to be external. */
function rewritePassthroughLinks(vaultId, html) {
  return html.replace(ANCHOR_RE, (full, attrs, inner) => {
    const cls = ATTR_CLASS_RE.exec(attrs)?.[1] || "";
    if (!/\bpassthrough-link\b/.test(cls)) return full;
    const href = ATTR_HREF_RE.exec(attrs)?.[1] || "";
    if (!href.startsWith("/")) return full;
    const path = decodeURIComponent(href.replace(/^\//, ""));
    if (!CACHED_EXT_RE.test(path)) return full;
    const newAttrs = attrs.replace(ATTR_HREF_RE, `href="${escapeAttr(localFileUrl(vaultId, path))}"`);
    return `<a${newAttrs}>${inner}</a>`;
  });
}

function stripTags(s) { return s.replace(TAG_RE, "").trim(); }
