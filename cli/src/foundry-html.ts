// Turn a page's rendered article HTML into what a Foundry journal wants:
// links become Foundry UUIDs, media becomes `@vaults/<variant>/<path>`
// references the provider resolves on the reader's machine.
//
// The variant segment is load-bearing: each role's deploy holds only the
// files its pages reference, so resolving without it means guessing, and
// guessing upward hands a player a file their role was built to withhold.
// A `.foundry.html` suffix marks a body to inline; anything else is a file.

import { htmlAttr } from "./escape.js";

/**
 * Where a page ended up. Most pages become a journal page and a link lands on
 * the prose, even when the page also instantiates an Actor or a Scene. A page
 * with `journal: false` has only its document, so a link carries that instead.
 */
export type LinkTarget =
  | { entry: string; page: string; doc?: never }
  | { entry?: never; page?: never; doc: { type: string; pack: string; id: string } };

export interface LinkIndex {
  /** Vault path (`"Characters/Marlo.md"`) to where it went. */
  targets: Map<string, LinkTarget>;
  /** The pack journals live in, for building Compendium UUIDs. */
  journalPack: string;
  moduleId: string;
  /**
   * How the vault is delivered, which decides what a link may name.
   *
   * A compendium is never imported as a unit, so the pack copy is the copy and
   * a link names it. An Adventure becomes real documents in the world on
   * import, keeping their ids, so a link has to name those — pointing into the
   * pack would send a reader to a second copy of the thing sitting beside the
   * one they are reading.
   */
  packaging: "compendium" | "adventure";
}

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const MEDIA_SRC_RE = /<(img|audio|video)\b([^>]*?)src="([^"]+)"([^>]*)>/gi;
const HREF_RE = /\bhref="([^"]+)"/i;
const CLASS_RE = /\bclass="([^"]+)"/i;
const TAG_RE = /<[^>]+>/g;

/** `"/Characters/Marlo"` back to `"Characters/Marlo.md"`. */
export function pathFromHref(href: string): string | null {
  if (!href.startsWith("/")) return null;
  const clean = href.split("#")[0]!.split("?")[0]!;
  let decoded: string;
  try { decoded = decodeURIComponent(clean); } catch { decoded = clean; }
  const trimmed = decoded.replace(/^\/+/, "").replace(/\.html$/i, "");
  return trimmed ? `${trimmed}.md` : null;
}

/** The UUID a link to `path` should carry, or null if nothing points there. */
export function uuidFor(path: string, index: LinkIndex): string | null {
  const target = index.targets.get(path);
  if (!target) return null;

  if (target.doc) {
    const { type, pack, id } = target.doc;
    return index.packaging === "adventure"
      ? `${type}.${id}`
      : `Compendium.${index.moduleId}.${pack}.${type}.${id}`;
  }
  const { entry, page } = target;
  return index.packaging === "adventure"
    ? `JournalEntry.${entry}.JournalEntryPage.${page}`
    : `Compendium.${index.moduleId}.${index.journalPack}.JournalEntry.${entry}.JournalEntryPage.${page}`;
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
    if (!/\binternal-link\b/.test(cls)) return whole;
    if (/\bis-unresolved\b/.test(cls)) return whole;

    const href = HREF_RE.exec(attrs)?.[1];
    if (!href) return whole;
    const path = pathFromHref(href);
    if (!path) return whole;

    const uuid = uuidFor(path, index);
    if (!uuid) return whole;

    const label = escapeBraces(stripTags(inner));
    return label ? `@UUID[${uuid}]{${label}}` : `@UUID[${uuid}]`;
  });
}

/**
 * Point media at the variant-scoped file the provider should fetch.
 *
 * Where a file lands is a runtime fact — it depends on the world it is being
 * built into — so the CLI names what it wants rather than guessing a path.
 */
export function rewriteAssets(html: string, variant: string): string {
  const mark = (p: string) => `@vaults/${variant}/${p.replace(/^\/+/, "")}`;
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
 * Rewrite `@vault/PATH` values inside a document patch to vault references.
 *
 * `@vault/` is the authoring form: written by hand in frontmatter, and left in
 * the Scene sidecars exported from Foundry. It has no variant because the
 * author is describing their own vault, where there is only one copy of the
 * file. Resolving it means deciding which role's copy this document reads, and
 * that is the same decision `visibility` already made for the body.
 */
export function rewriteVaultRefs<T>(value: T, variant: string): T {
  if (typeof value === "string") {
    return (value.startsWith("@vault/")
      ? `@vaults/${variant}/${value.slice("@vault/".length)}`
      : value) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteVaultRefs(v, variant)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, rewriteVaultRefs(v, variant)]),
    ) as unknown as T;
  }
  return value;
}

/** Everything a body needs before it can be a journal page. */
export function toFoundryHtml(html: string, index: LinkIndex, variant: string): string {
  return rewriteAssets(rewriteLinks(html, index), variant);
}
