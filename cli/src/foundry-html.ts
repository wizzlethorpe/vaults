// Turn a page's rendered article HTML into what a Foundry journal wants.
//
// This ran in Foundry at sync time, against ids the module derived for itself.
// It runs here now, because the emitter already knows every id it will write:
// a link can be resolved while the page is being built rather than rediscovered
// on every reader's machine, which makes it deterministic and testable without
// a world.
//
// Two rewrites live here. Links become Foundry UUIDs. Media becomes a vault
// reference the provider resolves, since where a downloaded file lands is a
// runtime fact the CLI cannot know and should not guess.
//
// One reference form covers both a page body and a piece of media:
//
//   @vaults/<variant>/<path>
//
// The variant is not decoration. A vault deploys each role its own directory,
// and a file is only in it if a page that role can see refers to it, so a DM
// creature's token exists under `DM/` and nowhere else. A reference without a
// variant names a file that exists for some readers and not others and says
// nothing about which — the provider would have to guess, and guessing upward
// hands a player something their role was built to withhold. What the
// consumer does with the file (inline the text, or save the bytes and use the
// path) follows from the `.foundry.html` suffix, which only bodies carry.

import { htmlAttr } from "./escape.js";

/**
 * Where a page ended up. Every page becomes a journal page, so that is what a
 * link resolves to, including for a page that also instantiates an Actor or a
 * Scene: the prose is what somebody following a link is after, and nothing in
 * the frontmatter says otherwise.
 */
export interface LinkTarget { entry: string; page: string }

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
