// Turn a page's rendered article HTML into what a Foundry journal wants:
// links become Foundry world UUIDs, media names the path the file's asset
// handler will place it at, what a player may not see sits in Foundry's
// secrets, and the stylesheet is written onto the elements.

import { createHash } from "node:crypto";

import type { Element, ElementContent, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import { selectAll } from "hast-util-select";
import { toHtml } from "hast-util-to-html";

import { inlineCss, storedStyle } from "./inline-css.js";
import { htmlAttr, htmlUnescape, PALETTE } from "@wizzlethorpe/vaults/addon";

/**
 * Where a page ended up: its journal page, its document, or both. A wikilink
 * lands on the journal page when there is one; a `fvtt-link:` prefers the
 * document; either falls back to whichever home exists.
 */
export interface LinkTarget {
  entry?: string;
  page?: string;
  doc?: { type: string; id: string };
}

export interface LinkIndex {
  /** Vault path (`"Characters/Marlo.md"`) to where it went. */
  targets: Map<string, LinkTarget>;
}

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const MEDIA_SRC_RE = /<(img|audio|video)\b([^>]*?)src="([^"]+)"([^>]*)>/gi;
const HREF_RE = /\bhref="([^"]+)"/i;
const CLASS_RE = /\bclass="([^"]+)"/i;
const TAG_RE = /<[^>]+>/g;

/** `"/Characters/Marlo"` back to `"Characters/Marlo.md"`. */
export function pathFromHref(href: string): string | null {
  // The entity pass comes first because it is the parser layer: the serializer
  // wrote `'` as `&#x27;`, and only what it produces is percent-encoded.
  const unescaped = htmlUnescape(href);
  if (!unescaped.startsWith("/")) return null;
  const clean = unescaped.split("#")[0]!.split("?")[0]!;
  let decoded: string;
  try { decoded = decodeURIComponent(clean); } catch { decoded = clean; }
  const trimmed = decoded.replace(/^\/+/, "").replace(/\.html$/i, "");
  return trimmed ? `${trimmed}.md` : null;
}

/**
 * The UUID a link to `path` should carry, or null if nothing points there.
 *
 * World UUIDs, because a vault builds into the world: the documents a reader
 * links to are the ones sitting in their own sidebar.
 */
export function uuidFor(path: string, index: LinkIndex, prefer: "journal" | "doc" = "journal"): string | null {
  const target = index.targets.get(path);
  if (!target) return null;

  const docUuid = target.doc ? `${target.doc.type}.${target.doc.id}` : null;
  const pageUuid = target.entry && target.page
    ? `JournalEntry.${target.entry}.JournalEntryPage.${target.page}`
    : null;
  return prefer === "doc" ? (docUuid ?? pageUuid) : (pageUuid ?? docUuid);
}

/** Per segment, so a literal `%` in a name survives a name with a space in it. */
function decodePath(path: string): string {
  return path.split("/").map((seg) => { try { return decodeURIComponent(seg); } catch { return seg; } }).join("/");
}

const stripTags = (s: string) => s.replace(TAG_RE, "").trim();

/** `}` inside a label would close the enricher early. */
const escapeBraces = (s: string) => s.replace(/\{/g, "&lbrace;").replace(/\}/g, "&rbrace;");

/**
 * Rewrite internal links to Foundry UUID enrichers.
 *
 * A link the index cannot place is left exactly as it is: an unresolved
 * wikilink already renders as broken-styled text on the wiki, and turning it
 * into a UUID that resolves to nothing would look worse in Foundry, not
 * better.
 */
export function rewriteLinks(html: string, index: LinkIndex): string {
  return html.replace(ANCHOR_RE, (whole, attrs: string, inner: string) => {
    const cls = CLASS_RE.exec(attrs)?.[1] ?? "";
    const card = /\bbases-card\b/.test(cls);
    if (!card && !/\binternal-link\b/.test(cls)) return whole;
    if (/\bis-unresolved\b/.test(cls)) return whole;

    const href = HREF_RE.exec(attrs)?.[1];
    if (!href) return whole;
    const path = pathFromHref(href);
    if (!path) return whole;

    const uuid = uuidFor(path, index, /\bfvtt-doc-link\b/.test(cls) ? "doc" : "journal");
    if (!uuid) return whole;

    // A card's layout lives in its markup, which an @UUID enricher would
    // flatten to a text link. A content-link anchor keeps the markup and
    // Foundry's click handler opens the document all the same.
    if (card) {
      // The rest of the anchor stays, including the style journalBody wrote.
      const rest = attrs.replace(HREF_RE, "").replace(CLASS_RE, "").trim();
      return `<a class="${htmlAttr(cls)} content-link"${rest ? ` ${rest}` : ""} draggable="true" data-link="" data-uuid="${htmlAttr(uuid)}">${inner}</a>`;
    }
    const label = escapeBraces(stripTags(inner));
    return label ? `@UUID[${uuid}]{${label}}` : `@UUID[${uuid}]`;
  });
}

/**
 * Point media at the path the asset handler will place the file at.
 *
 * The CLI chooses the destination and puts it in the file's `assets` block, so
 * the document can name it directly. A handler only places bytes; nothing
 * rewrites an entry after the fact.
 */
export function rewriteAssets(html: string, assetBase: string, named: Set<string>): string {
  // Decoded, because a destination is a filesystem path and the src it came
  // from is a URL. The `assets` block names the same file, and only the raw
  // form matches what the handler writes to disk.
  const mark = (p: string) => {
    const path = decodePath(p.replace(/^\/+/, ""));
    named.add(path);
    return `${assetBase}/${path}`;
  };
  let out = html.replace(MEDIA_SRC_RE, (whole, tag: string, before: string, src: string, after: string) =>
    src.startsWith("/") ? `<${tag}${before}src="${htmlAttr(mark(src))}"${after}>` : whole);

  out = out.replace(ANCHOR_RE, (whole, attrs: string, inner: string) => {
    const cls = CLASS_RE.exec(attrs)?.[1] ?? "";
    if (!/\bpassthrough-link\b/.test(cls)) return whole;
    const href = HREF_RE.exec(attrs)?.[1];
    if (!href?.startsWith("/")) return whole;
    return `<a${attrs.replace(HREF_RE, `href="${htmlAttr(mark(href))}"`)}>${inner}</a>`;
  });
  return out;
}

/**
 * Rewrite `@vault/PATH` values inside a document patch to the paths the asset handler places those files at.
 *
 * `@vault/` is the authoring form: written by hand in frontmatter, and left in
 * the Scene sidecars exported from Foundry. Resolving it means naming the
 * place the asset handler will put the file.
 */
export function rewriteVaultRefs<T>(value: T, assetBase: string, named: Set<string>): T {
  if (typeof value === "string") {
    if (!value.startsWith("@vault/")) return value;
    const path = value.slice("@vault/".length);
    named.add(path);
    return `${assetBase}/${path}` as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteVaultRefs(v, assetBase, named)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, rewriteVaultRefs(v, assetBase, named)]),
    ) as unknown as T;
  }
  return value;
}

/**
 * The wiki stylesheet's palette, which a journal does not define. Taken from
 * Foundry's theme where it has an equivalent, so the page follows dark mode.
 */
const THEME = [
  `--fg: var(--color-text-primary, ${PALETTE.fg})`,
  `--muted: var(--color-text-secondary, ${PALETTE.muted})`,
  `--rule: var(--color-border, ${PALETTE.rule})`,
  "--bg: transparent",
  `--accent: ${PALETTE.accent}`,
  `--accent-soft: ${PALETTE.accentSoft}`,
  `--wikilink-bg: ${PALETTE.wikilinkBg}`,
].join("; ");

export interface JournalOptions {
  /** Lowercase role names a player may not see. Empty on a page players never open. */
  secretRoles: ReadonlySet<string>;
  /** Rules to write onto the elements they match. */
  css: string;
}

const hasClass = (el: Element, name: string): boolean => {
  const classes = el.properties["className"];
  return Array.isArray(classes) && classes.includes(name);
};

function prune(node: Root | Element, drop: (el: Element) => boolean): void {
  node.children = (node.children as ElementContent[])
    .filter((c) => c.type !== "element" || !drop(c)) as typeof node.children;
  for (const c of node.children) if (c.type === "element") prune(c, drop);
}

/** Foundry's own secret, its id taken from its content so a rebuild names it the same. */
function secretSection(children: ElementContent[]): Element {
  const id = createHash("sha1").update(toHtml(children)).digest("hex").slice(0, 16);
  return { type: "element", tagName: "section", properties: { className: ["secret"], id: `secret-${id}` }, children };
}

/**
 * Every block gated to a role in `secret` put behind a Foundry secret.
 *
 * A bases item cannot be wrapped where it stands: a section inside a table is
 * hoisted out ahead of it and leaves the row in the open. So a block holding
 * gated items is split, and the copy in the secret holds only those items.
 */
function hideFromPlayers(tree: Root, secret: ReadonlySet<string>): void {
  const gated = (el: Element): boolean => {
    const role = el.properties["dataVaultsRole"] ?? el.properties["dataCallout"];
    return typeof role === "string" && secret.has(role.toLowerCase());
  };
  const walk = (node: Root | Element): void => {
    const out: ElementContent[] = [];
    for (const child of node.children as ElementContent[]) {
      if (child.type !== "element") { out.push(child); continue; }
      if (gated(child)) { out.push(secretSection([child])); continue; }
      if (hasClass(child, "bases-block") && selectAll("[data-vaults-role]", child).some(gated)) {
        const copy = structuredClone(child);
        prune(child, gated);
        prune(copy, (el) => el.properties["dataVaultsRole"] !== undefined && !gated(el));
        out.push(child, secretSection([copy]));
        continue;
      }
      walk(child);
      out.push(child);
    }
    node.children = out as typeof node.children;
  };
  walk(tree);
}

/**
 * A page's render reshaped for a journal: web-only markup dropped, what a
 * player may not see behind Foundry's secrets, and `css` written onto the
 * elements, since a journal page keeps no stylesheet of its own.
 */
export function journalBody(html: string, { secretRoles, css }: JournalOptions): string {
  const tree = fromHtml(html, { fragment: true });
  prune(tree, (el) => hasClass(el, "vaults-web-only"));
  if (secretRoles.size) hideFromPlayers(tree, secretRoles);
  for (const el of selectAll("[data-vaults-role]", tree)) delete el.properties["dataVaultsRole"];
  inlineCss(tree, css);
  // Foundry's sanitiser stores every style in this form. Written any other
  // way, the stored page never matches a rebuild and is rewritten every time.
  for (const el of selectAll("[style]", tree)) {
    const style = storedStyle(String(el.properties["style"]));
    if (style) el.properties["style"] = style;
    else delete el.properties["style"];
  }
  const page: Element = {
    type: "element", tagName: "div", properties: { style: storedStyle(THEME) }, children: tree.children as ElementContent[],
  };
  return toHtml(page);
}

/**
 * `named` collects the vault-relative path of every asset the result points at,
 * which is how the build knows exactly which files to ship and no others.
 */
export function toFoundryHtml(
  html: string, index: LinkIndex, assetBase: string, named: Set<string>, journal: JournalOptions,
): string {
  // After journalBody, not before: an enricher escapes braces in its label as
  // entities, and parsing the HTML again would decode them.
  return rewriteAssets(rewriteLinks(journalBody(html, journal), index), assetBase, named);
}
