// Which assets ship to which variant.
//
// This is a **role-gating boundary**, not a copy helper: an image or audio
// file lands in a variant only when a page visible at that tier references it.
// A DM-only map referenced only from a DM-only page must not reach the public
// deploy, where the middleware would serve it happily — the gate is that the
// bytes were never copied there.
//
// References are found four ways, because authors write them four ways:
// Obsidian embeds and wikilinks, CommonMark links, `gallery` and `battlemap`
// block bodies, and `@vault/PATH` strings inside foundry frontmatter (a
// Scene background, a Playlist's sounds) that no prose scanner would see.

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { battlemapLayerPaths } from "./render/handlers/builtin/battlemap.js";
import { downloadFilePaths } from "./render/handlers/builtin/download.js";
import { foundryManifestPaths } from "./render/handlers/builtin/foundry-manifest.js";
import { IMAGE_EXT_RE } from "./render/extensions.js";
import { slugify } from "./render/slug.js";
import type { ImageEntry, PageMeta } from "./render/types.js";
import { loadDataJson } from "./foundry-meta.js";

// The optional backslash matters: a table cell has to escape the size hint's
// pipe, and keeping that backslash in the name misses the index silently.
const EMBED_RE = /!\[\[([^\[\]|#\n]+?)\\?(?:\|[^\[\]#\n]*)?\]\]/g;

// A ```gallery code block. Its body lists images by name (one per line,
// optional `| caption`), which the gallery handler renders but the source
// scanners would otherwise never see — so we read the block here to stage
// the referenced images per variant, the same way `![[ ]]` embeds are staged.
const GALLERY_BLOCK_RE = /^```gallery[^\n]*\n([\s\S]*?)^```/gm;

// `[label](path/to/file.ext)` style markdown link. Captures the URL part.
// `\.[a-z0-9]+` requires an extension; we don't want to scoop up plain
// internal page links (e.g. `(href)` without an extension).
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+\.[a-z0-9]+)(?:\s+["'][^"']*["'])?\)/gi;

// `[[file.ext]]` and `![[file.ext]]` — Obsidian-flavoured wikilinks/embeds.
const WIKI_LINK_RE = /!?\[\[([^\[\]|#\n]+\.[a-z0-9]+)\\?(?:\|[^\[\]#\n]*)?(?:#[^\[\]\n]*)?\]\]/gi;

/** Image basenames referenced inside a page's ```gallery blocks. */
function galleryImageNames(source: string): string[] {
  const names: string[] = [];
  for (const block of source.matchAll(GALLERY_BLOCK_RE)) {
    for (const line of block[1]!.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const name = (trimmed.split("|")[0] ?? "").trim();
      if (name) names.push(name);
    }
  }
  return names;
}

export async function copyReferencedImages(
  visibleSources: Map<string, string>,
  visibleMetas: PageMeta[],
  imageIndex: Map<string, ImageEntry>,
  stagingDir: string,
  variantDir: string,
): Promise<string[]> {
  const refs = new Set<string>();
  for (const source of visibleSources.values()) {
    for (const m of source.matchAll(EMBED_RE)) {
      const name = m[1]!.trim();
      if (!IMAGE_EXT_RE.test(name)) continue;
      const image = imageIndex.get(slugify(name));
      if (image) refs.add(image.outputPath);
    }
    for (const name of galleryImageNames(source)) {
      const image = imageIndex.get(slugify(name.split("/").pop()!));
      if (image) refs.add(image.outputPath);
    }
    // Standard-Markdown image refs, `![alt](path/to/img.png)`. Without this
    // only Obsidian `![[embed]]` syntax staged images, so CommonMark-syntax
    // images rendered into HTML but 404'd on deploy. Mirrors the same MD_LINK_RE
    // pass copyReferencedPassthroughs runs for `[label](file.pdf)` links.
    for (const m of source.matchAll(MD_LINK_RE)) {
      const name = m[1]!.trim();
      if (/^(https?:|mailto:|#)/i.test(name)) continue;
      if (!IMAGE_EXT_RE.test(name)) continue;
      const image = imageIndex.get(slugify(name.split("/").pop()!));
      if (image) refs.add(image.outputPath);
    }
    // Layers named inside ```battlemap blocks. A web-only layer (e.g. a
    // composited tile overlay) has no other reference to stage it, so look
    // it up by its full vault-relative path.
    for (const path of battlemapLayerPaths(source)) {
      const image = imageIndex.get(path);
      if (image) refs.add(image.outputPath);
    }
  }
  // Pages can name their cover via `image:` frontmatter alone (no body embed);
  // pull those in too. coverImage was resolved to the served URL upstream, so
  // strip the leading slash + decode to get back to the staging-relative path.
  // `@vault/PATH` references inside any frontmatter string field also gate
  // an asset into this variant — common for Scene background.src / Playlist
  // sound.path that point at vault-shipped media. Page-role gating still
  // applies because we only walk visibleMetas (= pages this variant can see).
  for (const p of visibleMetas) {
    if (p.coverImage && !/^https?:\/\//i.test(p.coverImage)) {
      try { refs.add(decodeURIComponent(p.coverImage.replace(/^\//, ""))); }
      catch { /* malformed coverImage URL — ignore */ }
    }
    if (p.frontmatter) {
      forEachString(p.frontmatter, (s) => {
        const path = vaultRefPath(s);
        if (path && IMAGE_EXT_RE.test(path)) {
          const image = imageIndex.get(path);
          if (image) refs.add(image.outputPath);
        }
      });
    }
    // Image refs inside the page's foundry.patch_json (Scene backgrounds, tiles).
    for (const path of p.foundryAssets ?? []) {
      if (!IMAGE_EXT_RE.test(path)) continue;
      const image = imageIndex.get(path);
      if (image) refs.add(image.outputPath);
    }
  }
  const copied: string[] = [];
  for (const outputPath of refs) {
    const src = join(stagingDir, outputPath);
    const dst = join(variantDir, outputPath);
    await mkdir(dirname(dst), { recursive: true });
    try {
      await copyFile(src, dst);
      copied.push(outputPath);
    } catch (err) {
      // Source may legitimately be missing if the file is in the index but
      // wasn't compressed (e.g. quality=0 path). Surface but don't crash.
      console.warn(`  warning: could not copy image ${outputPath}: ${(err as Error).message}`);
    }
  }
  return copied;
}

/** Collect the `@vault/...` paths a page's foundry block references, from both
 *  `foundry.patch_json` and `foundry.patch`. A Scene's bulk asset refs
 *  (backgrounds, ambient sounds, tiles) live in that JSON content, and a token's
 *  ring subject lives in the inline `data` overlay; neither appears anywhere the
 *  per-variant asset scanners look, so without this they never ship and Foundry
 *  404s them. Returns vault-relative paths. */
export async function collectDataJsonVaultRefs(
  vaultPath: string,
  fm: Record<string, unknown>,
  pagePath: string,
): Promise<string[]> {
  const fo = fm["foundry"];
  if (!fo || typeof fo !== "object" || Array.isArray(fo)) return [];
  const block = fo as Record<string, unknown>;
  const out: string[] = [];
  const collect = (from: unknown) => forEachString(from, (s) => {
    const path = vaultRefPath(s);
    if (path) out.push(path);
  });

  const rel = block["patch_json"];
  if (typeof rel === "string" && rel.trim()) {
    const parsed = await loadDataJson(vaultPath, rel.trim(), pagePath);
    if (parsed !== null) collect(parsed);
  }
  collect(block["patch"]);
  return out;
}

/**
 * Visit every string value reachable from `value` (object / array / scalar)
 * and call `fn` once per string. Used to surface `@vault/PATH` references
 * inside parsed frontmatter (e.g., a Scene's `foundry.patch.background.src`
 * or a Playlist's `foundry.patch.sounds[N].path`) so the per-variant asset
 * scanner can include those files alongside body-referenced ones.
 */
export function forEachString(value: unknown, fn: (s: string) => void): void {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) { for (const v of value) forEachString(v, fn); return; }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) forEachString(v, fn);
  }
}

/** Extract a vault path from a `@vault/PATH` string, or null when the
 *  string isn't a vault reference. Trailing fragment / query stripped. */
export function vaultRefPath(s: string): string | null {
  if (!s.startsWith("@vault/")) return null;
  const rest = s.slice("@vault/".length).split("#")[0]!.split("?")[0]!;
  return rest.length > 0 ? rest : null;
}

/**
 * Per-variant reference scan for passthrough files. A file lands in this
 * variant's deploy only if a visible page mentions it — same gating story
 * as images. Match patterns cover Obsidian embeds (`![[file.pdf]]`),
 * Obsidian wikilinks (`[[file.pdf]]`), and standard markdown links
 * (`[label](path/file.pdf)`). Anything not matched is dropped — that's
 * the whole point of the change; a stray DM-only audio cue stays in the
 * dm variant only.
 */
export async function copyReferencedPassthroughs(
  visibleSources: Map<string, string>,
  visibleMetas: PageMeta[],
  passthroughIndex: Map<string, ImageEntry>,
  stagingDir: string,
  variantDir: string,
  /**
   * Manifest path -> the file its own `download` field names. A
   * foundry-manifest block names only the manifest, so the zip has no other
   * reference to gate it into this variant; without this it would be staged
   * and then shipped nowhere. Keyed by manifest so the zip inherits the
   * manifest's role: a DM-only install link does not leak its module.
   */
  manifestDownloads: ReadonlyMap<string, string> = new Map(),
): Promise<string[]> {
  if (passthroughIndex.size === 0) return [];
  const refs = new Set<string>();
  for (const source of visibleSources.values()) {
    for (const m of source.matchAll(WIKI_LINK_RE)) {
      const name = m[1]!.trim();
      const entry = passthroughIndex.get(slugify(name.split("/").pop()!));
      if (entry) refs.add(entry.outputPath);
    }
    for (const m of source.matchAll(MD_LINK_RE)) {
      const name = m[1]!.trim();
      // Skip http(s) links and anchor-only refs.
      if (/^(https?:|mailto:|#)/i.test(name)) continue;
      const entry = passthroughIndex.get(slugify(name.split("/").pop()!));
      if (entry) refs.add(entry.outputPath);
    }
    // Files named by ```download blocks, looked up by full vault-relative
    // path rather than basename: a download names an exact file, and two
    // releases called module.json in different folders must not collide.
    for (const path of [...downloadFilePaths(source), ...foundryManifestPaths(source)]) {
      const entry = passthroughIndex.get(path);
      if (entry) refs.add(entry.outputPath);
      const derived = manifestDownloads.get(path);
      if (derived) {
        const zip = passthroughIndex.get(derived);
        if (zip) refs.add(zip.outputPath);
      }
    }
  }
  // `@vault/PATH` references inside any frontmatter string also gate a
  // passthrough into this variant. Same per-page-role visibility rules
  // (only walking visibleMetas) — a dm-tier page's @vault/Audio/secret.ogg
  // ships only to the dm variant.
  for (const p of visibleMetas) {
    if (!p.frontmatter) continue;
    forEachString(p.frontmatter, (s) => {
      const path = vaultRefPath(s);
      if (path) {
        const entry = passthroughIndex.get(path);
        if (entry) refs.add(entry.outputPath);
      }
    });
    // Audio/video/pdf refs inside the page's foundry.patch_json (ambient sounds).
    for (const path of p.foundryAssets ?? []) {
      const entry = passthroughIndex.get(path);
      if (entry) refs.add(entry.outputPath);
    }
  }
  const copied: string[] = [];
  for (const outputPath of refs) {
    const src = join(stagingDir, outputPath);
    const dst = join(variantDir, outputPath);
    await mkdir(dirname(dst), { recursive: true });
    try {
      await copyFile(src, dst);
      copied.push(outputPath);
    } catch (err) {
      console.warn(`  warning: could not copy ${outputPath}: ${(err as Error).message}`);
    }
  }
  return copied;
}
