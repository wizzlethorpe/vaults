import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { dirname, join } from "node:path";
import { availableParallelism } from "node:os";
import picomatch from "picomatch";
import { scanVault, type ScannedFile } from "./scan.js";
import { compressImage, COMPRESSIBLE_EXT_RE } from "./images.js";
import { buildFavicon } from "./favicon.js";

// Any image format that can be referenced via ![[name.ext]]; superset of
// COMPRESSIBLE_EXT_RE since SVGs/GIFs ship as-is rather than being recoded.
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|tiff?)$/i;
// Recognised non-image media that ride alongside the wiki: audio, video,
// portable docs. Ship per-variant just like images (only into variants
// whose visible pages reference them) so DM-only audio cues can't leak
// into the public deploy. Anything outside this list is treated as
// "unknown" and skipped by default; see the include_unknown_files setting.
const PASSTHROUGH_EXT_RE = /\.(ogg|mp3|m4a|wav|flac|opus|aac|mp4|webm|mov|ogv|pdf|epub)$/i;
import { renderMarkdown } from "./render/pipeline.js";
import { renderLayout, render404 } from "./render/layout.js";
import { slugify } from "./render/slug.js";
import { buildPreview } from "./render/preview.js";
import { resolvePageImage } from "./render/cover.js";
import { DEFAULT_CSS, renderThemeOverride } from "./render/styles.js";
import { loadObsidianSnippets } from "./obsidian.js";
import { loadSettings, writeSettings, SETTINGS_FILE, type Settings } from "./settings.js";
import { loadConfig, saveConfig, type VaultConfig } from "./config.js";
import matter from "gray-matter";
import { renderAuthMiddleware, LOGIN_HTML } from "./render/auth-template.js";
import type { ImageEntry, PageMeta, RenderContext, RenderWarning } from "./render/types.js";
import { formatDuration, pMap, Progress } from "./util.js";

export interface BuildOptions {
  vaultPath: string;
  outputDir: string;
  vaultName: string;
  imageQuality: number;
  maxFileBytes: number;
  /** Show every page with warnings instead of truncating at 20. */
  allWarnings?: boolean;
}

export interface BuildResult {
  files: ScannedFile[];
  withinLimit: ScannedFile[];
  /** All roles built, in low → high order. */
  roles: string[];
  /** Per-role page count. */
  perRolePageCount: Record<string, number>;
  imageCount: number;
  otherCount: number;
}

/**
 * Output layout when there are multiple roles:
 *
 *   <outputDir>/
 *     attachments/...        (shared images)
 *     <other files>...        (shared)
 *     styles.css, user.css    (shared)
 *     _variants/
 *       <role>/
 *         <pages>.html
 *         <pages>.preview.json
 *         _search-index.json
 *
 * When there's a single role (the default `public`-only case) we collapse
 * `_variants/public/...` up to the root for backwards compatibility with
 * the current `vaults preview` and `vaults push` flow.
 */
export async function buildSite(opts: BuildOptions): Promise<BuildResult> {
  const start = Date.now();
  const concurrency = Math.max(2, availableParallelism());

  // One-shot migration for vaults from before auth config moved to
  // .vaultrc.json. If the user's settings.md still has roles/auth_type/
  // role_passwords, copy them over before the canonicalizer strips them.
  await migrateLegacyAuthFromSettings(opts.vaultPath);

  // ── Settings (user-editable) ─────────────────────────────────────────────
  const settings = await loadSettings(opts.vaultPath);
  for (const w of settings.warnings) console.warn(`  ${w}`);
  if (settings.exists && settings.changed) {
    await writeSettings(opts.vaultPath, settings.values);
    console.log(`  rewrote ${SETTINGS_FILE} to canonical format`);
  }
  opts = {
    ...opts,
    vaultName: opts.vaultName === "Vault" ? settings.values.vault_name : opts.vaultName,
    imageQuality: opts.imageQuality === 85 ? settings.values.image_quality : opts.imageQuality,
    maxFileBytes: opts.maxFileBytes === 25 * 1024 * 1024 ? settings.values.max_file_bytes : opts.maxFileBytes,
  };

  // ── CLI-managed state (auth) ─────────────────────────────────────────────
  const cfg = await loadConfig(opts.vaultPath, {});
  const roles = cfg.roles.length > 0 ? cfg.roles : ["public"];
  const allRoleSet = new Set(roles);
  // Pages without a 'role:' frontmatter fall back to settings.default_role
  // when set (and valid); otherwise the lowest-tier role. This lets a
  // DM-by-default vault flip the polarity instead of tagging every private
  // page individually.
  let defaultRole = roles[0]!;
  if (settings.values.default_role) {
    if (allRoleSet.has(settings.values.default_role)) {
      defaultRole = settings.values.default_role;
    } else {
      console.warn(`  settings.md: default_role "${settings.values.default_role}" `
        + `not in configured roles [${roles.join(", ")}], using "${defaultRole}"`);
    }
  }

  // ── Scan + filter ────────────────────────────────────────────────────────
  console.log(`Scanning ${opts.vaultPath}...`);
  const scanStart = Date.now();
  const allFiles = await scanVault(opts.vaultPath);
  const ignoreMatchers = settings.values.ignore.map((p) => picomatch(p));
  const isIgnored = (path: string) => ignoreMatchers.some((m) => m(path));
  const files = allFiles.filter((f) => f.path !== SETTINGS_FILE && !isIgnored(f.path));
  const ignoredCount = allFiles.length - files.length - 1;
  console.log(`  found ${files.length} files in ${formatDuration(Date.now() - scanStart)}`
    + (ignoredCount > 0 ? ` (${ignoredCount} ignored by patterns)` : ""));

  const withinLimit = files.filter((f) => {
    if (f.size > opts.maxFileBytes) {
      console.warn(`  skipping ${f.path} (${f.size} bytes > ${opts.maxFileBytes} limit)`);
      return false;
    }
    return true;
  });

  await rm(opts.outputDir, { recursive: true, force: true });
  await mkdir(opts.outputDir, { recursive: true });

  const markdownFiles = withinLimit.filter((f) => /\.md$/i.test(f.path));
  const imageFiles = withinLimit.filter((f) => IMAGE_EXT_RE.test(f.path));
  // .base files are consumed at build time (rendered into HTML where embedded)
  // and never shipped to the deploy.
  const baseFiles = withinLimit.filter((f) => /\.base$/i.test(f.path));
  const passthroughFiles = withinLimit.filter((f) =>
    PASSTHROUGH_EXT_RE.test(f.path)
    && !IMAGE_EXT_RE.test(f.path)
    && !/\.md$|\.base$/i.test(f.path),
  );
  // Anything else: skipped by default so role-gated content can't leak
  // through a stray file. include_unknown_files = true folds them into
  // the passthrough pool (still reference-gated). The user-facing
  // warning lists exactly which paths got dropped so unintentional
  // omissions surface immediately.
  const unknownFiles = withinLimit.filter((f) =>
    !/\.md$|\.base$/i.test(f.path)
    && !IMAGE_EXT_RE.test(f.path)
    && !PASSTHROUGH_EXT_RE.test(f.path),
  );
  const includeUnknown = settings.values.include_unknown_files;
  if (unknownFiles.length > 0) {
    if (includeUnknown) {
      console.log(`  including ${unknownFiles.length} unknown-extension file(s) (include_unknown_files=true)`);
    } else {
      console.warn(`  skipping ${unknownFiles.length} file(s) with unrecognized extensions:`);
      const shown = unknownFiles.slice(0, 10);
      for (const f of shown) console.warn(`    ${f.path}`);
      if (unknownFiles.length > shown.length) {
        console.warn(`    … and ${unknownFiles.length - shown.length} more`);
      }
      console.warn(`    Set 'include_unknown_files: true' in settings.md to ship them.`);
    }
  }
  // Effective passthrough list: recognised media plus (optionally) unknowns.
  const stagedPassthroughs = includeUnknown
    ? [...passthroughFiles, ...unknownFiles]
    : passthroughFiles;

  // ── Shared content (read once, reused across roles) ─────────────────────
  const sources = new Map<string, string>();
  await pMap(markdownFiles, concurrency, async (f) => {
    sources.set(f.path, await readFile(f.absolute, "utf8"));
  });

  // .base files: keyed by basename slug so `![[Foo]]` (where Foo.base exists)
  // and `![[Foo#ViewName]]` resolve to the YAML source.
  const baseSources = new Map<string, string>();
  await pMap(baseFiles, concurrency, async (f) => {
    const basename = f.path.split("/").pop()!.replace(/\.base$/i, "");
    baseSources.set(slugify(basename), await readFile(f.absolute, "utf8"));
  });

  // Parse role + title per page. Pages with an unrecognised role fall back
  // to the default with a warning; better than silently dropping them. We
  // also stash the full frontmatter on each PageMeta so the Bases plugin
  // can query arbitrary properties.
  const allPageMetas: PageMeta[] = markdownFiles.map((f) => {
    const src = sources.get(f.path)!;
    const meta = parseFrontmatter(src);
    const fullFm = parseFullFrontmatter(src);
    let role = meta.role ?? defaultRole;
    if (!allRoleSet.has(role)) {
      console.warn(`  ${f.path}: role "${role}" not in settings.roles, using "${defaultRole}"`);
      role = defaultRole;
    }
    return {
      path: f.path,
      title: meta.title ?? extractH1(src) ?? basenameNoExt(f.path),
      role,
      ...(meta.aliases && meta.aliases.length > 0 ? { aliases: meta.aliases } : {}),
      ...(Object.keys(fullFm).length > 0 ? { frontmatter: fullFm } : {}),
      mtime: f.mtime,
      birthtime: f.birthtime,
    };
  });

  // ── Image compression (staged; copied per-variant later) ────────────────
  // Compress once into a private staging dir under the deploy root. Each
  // variant's render pass copies whichever images its visible pages
  // reference. The staging dir is removed at the end so images only ship
  // to the variants that need them; that's how DM-only art is kept off
  // the public deploy without a separate auth gate.
  const imageStagingDir = join(opts.outputDir, ".image-staging");
  const imageIndex = new Map<string, ImageEntry>();
  if (imageFiles.length > 0) {
    const cacheDir = join(opts.vaultPath, ".vault-cache", "images", `q${opts.imageQuality}`);
    await mkdir(cacheDir, { recursive: true });
    let cacheHits = 0;
    const progress = new Progress("Images");
    progress.update(0, imageFiles.length);

    await pMap(imageFiles, concurrency, async (f) => {
      // SVGs / non-compressible images pass through; everything else gets
      // recoded to webp for size. Either way they land in the staging dir.
      const compressed = opts.imageQuality > 0 && COMPRESSIBLE_EXT_RE.test(f.path)
        ? await compressImageCached(f, opts.imageQuality, cacheDir, () => { cacheHits++; })
        : { body: await readFile(f.absolute), outputPath: f.path };

      const dest = join(imageStagingDir, compressed.outputPath);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, compressed.body);

      imageIndex.set(slugify(f.path.split("/").pop()!), {
        sourcePath: f.path,
        outputPath: compressed.outputPath,
      });
    }, (done, total) => progress.update(done, total));

    progress.done(`${imageFiles.length} processed (${cacheHits} cached, ${imageFiles.length - cacheHits} compressed)`);
  }

  // ── Passthrough files (audio, video, PDF, epub) ────────────────────────
  // Staged once and copied into a variant only when a visible page in that
  // variant references the file by basename or relative path. Same gating
  // story as images: a DM-only audio cue can't ride along into the public
  // deploy because no public-tier source mentions it.
  const otherStagingDir = join(opts.outputDir, ".other-staging");
  const passthroughIndex = new Map<string, ImageEntry>();
  if (stagedPassthroughs.length > 0) {
    const progress = new Progress("Passthroughs");
    progress.update(0, stagedPassthroughs.length);
    await pMap(stagedPassthroughs, concurrency, async (f) => {
      const dest = join(otherStagingDir, f.path);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(f.absolute, dest);
      passthroughIndex.set(slugify(f.path.split("/").pop()!), {
        sourcePath: f.path,
        outputPath: f.path,
      });
    }, (done, total) => progress.update(done, total));
    progress.done(`${stagedPassthroughs.length} staged`);
  }

  // Shared CSS bundle
  const themeOverride = renderThemeOverride({
    lightAccent: settings.values.accent_color,
    lightBg: settings.values.bg_color,
  });
  await writeFile(join(opts.outputDir, "styles.css"), DEFAULT_CSS + themeOverride);
  const userCss = await loadObsidianSnippets(opts.vaultPath);
  await writeFile(join(opts.outputDir, "user.css"), userCss);
  if (userCss) console.log(`  loaded user.css from .obsidian/snippets/`);

  // Favicon; either user-supplied via settings.favicon, or a generated
  // default with the vault's first letter in accent on the theme background.
  try {
    const favicon = await buildFavicon({
      vaultPath: opts.vaultPath,
      faviconPath: settings.values.favicon,
      letter: (opts.vaultName || "V").trim().charAt(0).toUpperCase() || "V",
      backgroundColor: settings.values.bg_color || "#f4ecd8",
      accentColor: settings.values.accent_color || "#a8201a",
    });
    await writeFile(join(opts.outputDir, "favicon.ico"), favicon);
  } catch (err) {
    console.warn(`  warning: could not generate favicon: ${(err as Error).message}`);
  }

  // ── Resolve per-page cover images ───────────────────────────────────────
  // Computed once against the final imageIndex so OG meta tags, Bases card
  // covers, hover previews, and Foundry actor/item reskin all resolve to the
  // same URL. settings.auto_image flips body-fallback discovery on/off.
  for (const meta of allPageMetas) {
    const src = sources.get(meta.path);
    if (!src) continue;
    const cover = resolvePageImage(src, meta.frontmatter, imageIndex, settings.values.auto_image);
    if (cover) meta.coverImage = cover;
  }

  // ── Per-role variant builds ─────────────────────────────────────────────
  const perRolePageCount: Record<string, number> = {};
  const collapseToRoot = roles.length === 1;

  for (const role of roles) {
    const variantDir = collapseToRoot
      ? opts.outputDir
      : join(opts.outputDir, "_variants", role);
    if (!collapseToRoot) await mkdir(variantDir, { recursive: true });

    // Roles up to and including this one are visible. Anything higher is
    // redacted (callouts dropped, pages skipped, wikilinks broken).
    const idx = roles.indexOf(role);
    const visibleRoles = new Set(roles.slice(0, idx + 1));
    const redactRoles = new Set(roles.slice(idx + 1));

    const stats = await buildVariant({
      role,
      visibleRoles,
      redactRoles,
      variantDir,
      vaultName: opts.vaultName,
      allPageMetas,
      sources,
      baseSources,
      imageIndex,
      imageStagingDir,
      passthroughIndex,
      passthroughStagingDir: otherStagingDir,
      settings: settings.values,
      authConfigured: roles.length > 1,
      concurrency,
      allWarnings: opts.allWarnings,
    });
    perRolePageCount[role] = stats.pageCount;
    if (!collapseToRoot) console.log(`  variant '${role}': ${stats.pageCount} pages`);

    // Write a per-variant _manifest.json so external clients (Foundry, MCP,
    // etc.) can do an incremental diff. Includes EVERY file that variant
    // serves; html, md, images (as relative paths into shared root), css.
    // bodyMeta carries per-page Foundry reskin metadata; folded into each
    // body row's hash so meta-only changes trigger a re-sync.
    const manifest = await buildManifest(opts.outputDir, variantDir, stats.bodyMeta, !collapseToRoot, roles, opts.vaultName);
    await writeFile(join(variantDir, "_manifest.json"), JSON.stringify(manifest));
  }

  // ── Pages Functions ─────────────────────────────────────────────────────
  // Auth middleware ships only for multi-role builds. Single-role deploys
  // are pure static and need no functions.
  if (!collapseToRoot) {
    const fnDir = join(opts.outputDir, "functions");
    await mkdir(fnDir, { recursive: true });
    const middleware = renderAuthMiddleware({
      roles,
      rolePasswords: cfg.rolePasswords,
    });
    await writeFile(join(fnDir, "_middleware.js"), middleware);

    // Login page; drop in the role list (everything above the default).
    const protectedRoles = roles.slice(1);
    const opts_html = protectedRoles
      .map((r) => `<option value="${r}">${r}</option>`)
      .join("");
    await writeFile(join(opts.outputDir, "login.html"), LOGIN_HTML.replace("__ROLE_OPTIONS__", opts_html));

    const missing = protectedRoles.filter((r) => !cfg.rolePasswords[r]);
    if (missing.length > 0) {
      console.warn(`  WARNING: no password set for role(s): ${missing.join(", ")}. Run 'vaults password <role>' before pushing.`);
    }
  }

  // Drop the staging dirs; their contents have been copied into each
  // variant that needs them, so they're no longer required for the deploy.
  await rm(imageStagingDir, { recursive: true, force: true });
  await rm(otherStagingDir, { recursive: true, force: true });

  console.log(`Built in ${formatDuration(Date.now() - start)}.`);
  return {
    files,
    withinLimit,
    roles,
    perRolePageCount,
    imageCount: imageFiles.length,
    otherCount: stagedPassthroughs.length,
  };
}

interface VariantArgs {
  role: string;
  visibleRoles: ReadonlySet<string>;
  redactRoles: ReadonlySet<string>;
  variantDir: string;
  vaultName: string;
  allPageMetas: PageMeta[];
  sources: Map<string, string>;
  /** slugified basename → raw YAML for standalone `.base` files. */
  baseSources: Map<string, string>;
  imageIndex: Map<string, ImageEntry>;
  /** Staging dir holding compressed images; we copy what's referenced. */
  imageStagingDir: string;
  /** Passthrough media (audio/video/pdf/epub) staged once, reference-copied per variant. */
  passthroughIndex: Map<string, ImageEntry>;
  passthroughStagingDir: string;
  settings: Settings;
  /** Whether the deployment has more than one role (controls auth-box rendering). */
  authConfigured: boolean;
  concurrency: number;
  allWarnings: boolean | undefined;
}

interface VariantStats {
  pageCount: number;
  /** Maps `.body.html` path (variant-relative) to its meta payload. Empty unless any page sets foundry_base / image. */
  bodyMeta: Map<string, BodyMeta>;
}

async function buildVariant(a: VariantArgs): Promise<VariantStats> {
  // Pages this variant can see (page.role is in visibleRoles).
  const visibleSources = new Map<string, string>();
  const visibleMetas: PageMeta[] = [];
  for (const m of a.allPageMetas) {
    if (!a.visibleRoles.has(m.role)) continue;
    visibleMetas.push(m);
    visibleSources.set(m.path, a.sources.get(m.path)!);
  }

  // Synthesize folder indexes from the visible set only.
  const folderIndexes = generateFolderIndexes(visibleMetas, a.role);
  for (const fi of folderIndexes) {
    visibleMetas.push({ path: fi.path, title: fi.title, role: a.role });
    visibleSources.set(fi.path, fi.markdown);
  }

  // Per-variant page index for wikilink resolution. Basename, full-path,
  // and Obsidian frontmatter aliases are all keyed. Folder-index basenames
  // and aliases don't overwrite earlier entries (first-write-wins) so
  // ambiguous shorthands resolve to whichever page sorted first.
  const pageIndex = new Map<string, PageMeta>();
  const markdownContent = new Map<string, string>();
  for (const p of visibleMetas) {
    const basenameSlug = slugify(p.path.split("/").pop()!);
    const pathSlug = slugify(p.path.replace(/\.md$/i, ""));
    if (!pageIndex.has(basenameSlug)) pageIndex.set(basenameSlug, p);
    pageIndex.set(pathSlug, p);
    for (const alias of p.aliases ?? []) {
      const aliasSlug = slugify(alias);
      if (aliasSlug && !pageIndex.has(aliasSlug)) pageIndex.set(aliasSlug, p);
    }
    markdownContent.set(basenameSlug, visibleSources.get(p.path)!);
    markdownContent.set(pathSlug, visibleSources.get(p.path)!);
  }

  const context: RenderContext = {
    pages: pageIndex,
    images: a.imageIndex,
    markdownContent,
    bases: a.baseSources,
    defaultImageWidth: a.settings.default_image_width,
    redactRoles: a.redactRoles,
  };

  // Pass 1: render bodies + collect outlinks + warnings.
  interface Rendered { title: string; html: string; outlinks: string[]; warnings: RenderWarning[]; }
  const rendered = new Map<string, Rendered>();

  const progress = new Progress(`Pages (${a.role})`);
  progress.update(0, visibleMetas.length);
  await pMap(visibleMetas, a.concurrency, async (p) => {
    const result = await renderMarkdown(visibleSources.get(p.path)!, context, basenameNoExt(p.path));
    rendered.set(p.path, {
      title: result.title,
      html: result.html,
      outlinks: result.outlinks,
      warnings: result.warnings,
    });
  }, (done, total) => progress.update(done, total));

  reportWarnings(a.role, rendered, a.allWarnings);

  // Invert outlinks → backlinks. (Cross-role links can only point downwards
  // because higher-role pages aren't in this variant's index.)
  const backlinkMap = new Map<string, Set<string>>();
  for (const [from, info] of rendered) {
    const seen = new Set<string>();
    for (const target of info.outlinks) {
      if (target === from || seen.has(target)) continue;
      seen.add(target);
      if (!backlinkMap.has(target)) backlinkMap.set(target, new Set());
      backlinkMap.get(target)!.add(from);
    }
  }

  // Pass 2: write layouts + preview JSON.
  const bodyMeta = new Map<string, BodyMeta>();
  await pMap(visibleMetas, a.concurrency, async (p) => {
    const r = rendered.get(p.path)!;
    const backlinkPaths = backlinkMap.get(p.path) ?? new Set();
    const backlinks = visibleMetas
      .filter((m) => backlinkPaths.has(m.path))
      .sort((x, y) => x.title.localeCompare(y.title, undefined, { numeric: true, sensitivity: "base" }));
    const html = renderLayout({
      title: r.title,
      pagePath: p.path,
      bodyHtml: r.html,
      pages: visibleMetas,
      vaultName: a.vaultName,
      inlineTitle: a.settings.inline_title,
      defaultImageWidth: a.settings.default_image_width,
      centerImages: a.settings.center_images,
      backlinks,
      authConfigured: a.authConfigured,
      ...(p.mtime != null ? { mtime: p.mtime } : {}),
      ...(p.birthtime != null ? { birthtime: p.birthtime } : {}),
      ...(p.coverImage ? { coverImage: p.coverImage } : {}),
      ...(extractFrontmatterBlock(visibleSources.get(p.path)!) ?? {}),
    });
    const outputBase = p.path.replace(/\.md$/i, "");
    const htmlDest = join(a.variantDir, outputBase + ".html");
    await mkdir(dirname(htmlDest), { recursive: true });
    await writeFile(htmlDest, html);

    // .body.html holds just the rendered article content (no layout shell).
    // Foundry imports this so callouts/embeds rendered by the vault's
    // remark/rehype pipeline land in journals as-is, no client-side render.
    const bodyPath = outputBase + ".body.html";
    await writeFile(join(a.variantDir, bodyPath), r.html);

    bodyMeta.set(bodyPath, collectBodyMeta(p));

    const source = visibleSources.get(p.path)!;
    const preview = await buildPreview(source, r.title);
    await writeFile(join(a.variantDir, outputBase + ".preview.json"), JSON.stringify(preview));
  });

  progress.done(`${visibleMetas.length} rendered`);

  // 404 page using the same layout shell; middleware fetches this when a
  // variant rewrite returns 404 instead of leaking Pages's blank "Not found".
  await writeFile(join(a.variantDir, "404.html"), render404({
    pages: visibleMetas,
    vaultName: a.vaultName,
    inlineTitle: a.settings.inline_title,
    defaultImageWidth: a.settings.default_image_width,
    centerImages: a.settings.center_images,
    authConfigured: a.authConfigured,
  }));

  // Per-variant search index.
  const searchIndex = visibleMetas.map((p) => ({
    title: p.title,
    path: p.path,
    href: "/" + p.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/"),
    folder: p.path.includes("/") ? p.path.split("/").slice(0, -1).join("/") : "",
    text: extractPlainText(visibleSources.get(p.path) ?? "", 1500),
  }));
  await writeFile(join(a.variantDir, "_search-index.json"), JSON.stringify(searchIndex));

  // Copy whichever images this variant's pages reference. Images live only
  // under the variants that need them so guessing a DM-only image URL on
  // the public wiki structurally 404s. coverImage feeds in here too so
  // images named via `image:` frontmatter (no body embed) still ship.
  await copyReferencedImages(visibleSources, visibleMetas, a.imageIndex, a.imageStagingDir, a.variantDir);

  // Passthrough files (audio/video/pdf/epub) follow the same gating
  // contract as images: ship only into variants whose visible pages
  // reference the file. A DM-only audio cue can't ride along into the
  // public deploy because no public-tier source mentions it.
  await copyReferencedPassthroughs(visibleSources, a.passthroughIndex, a.passthroughStagingDir, a.variantDir);

  return { pageCount: visibleMetas.length, bodyMeta };
}

/**
 * Build the per-body manifest meta from a page's frontmatter + resolved
 * cover image. `role` always lands so the Foundry side can apply the
 * dmRole permission gate; the foundry_base / image fields are conditional.
 */
function collectBodyMeta(p: PageMeta): BodyMeta {
  const fm = p.frontmatter ?? {};
  const out: BodyMeta = { role: p.role };

  const basename = p.path.split("/").pop()!.replace(/\.md$/i, "");
  if (p.title && p.title !== basename) out.title = p.title;

  const fb = fm["foundry_base"];
  if (typeof fb === "string" && fb.trim().length > 0) {
    out.foundry_base = fb.trim();
  }

  const fo = fm["foundry"];
  if (fo && typeof fo === "object" && !Array.isArray(fo)) {
    out.foundry = fo as Record<string, unknown>;
  }

  if (p.coverImage) out.image = p.coverImage;

  return out;
}

const EMBED_RE = /!\[\[([^\[\]|#\n]+?)(?:\|[^\[\]#\n]*)?\]\]/g;

async function copyReferencedImages(
  visibleSources: Map<string, string>,
  visibleMetas: PageMeta[],
  imageIndex: Map<string, ImageEntry>,
  stagingDir: string,
  variantDir: string,
): Promise<void> {
  const refs = new Set<string>();
  for (const source of visibleSources.values()) {
    for (const m of source.matchAll(EMBED_RE)) {
      const name = m[1]!.trim();
      if (!IMAGE_EXT_RE.test(name)) continue;
      const image = imageIndex.get(slugify(name));
      if (image) refs.add(image.outputPath);
    }
  }
  // Pages can name their cover via `image:` frontmatter alone (no body embed);
  // pull those in too. coverImage was resolved to the served URL upstream, so
  // strip the leading slash + decode to get back to the staging-relative path.
  for (const p of visibleMetas) {
    if (!p.coverImage) continue;
    if (/^https?:\/\//i.test(p.coverImage)) continue;
    let outputPath;
    try { outputPath = decodeURIComponent(p.coverImage.replace(/^\//, "")); }
    catch { continue; }
    refs.add(outputPath);
  }
  for (const outputPath of refs) {
    const src = join(stagingDir, outputPath);
    const dst = join(variantDir, outputPath);
    await mkdir(dirname(dst), { recursive: true });
    try { await copyFile(src, dst); }
    catch (err) {
      // Source may legitimately be missing if the file is in the index but
      // wasn't compressed (e.g. quality=0 path). Surface but don't crash.
      console.warn(`  warning: could not copy image ${outputPath}: ${(err as Error).message}`);
    }
  }
}

// `[label](path/to/file.ext)` style markdown link. Captures the URL part.
// `\.[a-z0-9]+` requires an extension; we don't want to scoop up plain
// internal page links (e.g. `(href)` without an extension).
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+\.[a-z0-9]+)(?:\s+["'][^"']*["'])?\)/gi;
// `[[file.ext]]` and `![[file.ext]]` — Obsidian-flavoured wikilinks/embeds.
const WIKI_LINK_RE = /!?\[\[([^\[\]|#\n]+\.[a-z0-9]+)(?:\|[^\[\]#\n]*)?(?:#[^\[\]\n]*)?\]\]/gi;

/**
 * Per-variant reference scan for passthrough files. A file lands in this
 * variant's deploy only if a visible page mentions it — same gating story
 * as images. Match patterns cover Obsidian embeds (`![[file.pdf]]`),
 * Obsidian wikilinks (`[[file.pdf]]`), and standard markdown links
 * (`[label](path/file.pdf)`). Anything not matched is dropped — that's
 * the whole point of the change; a stray DM-only audio cue stays in the
 * dm variant only.
 */
async function copyReferencedPassthroughs(
  visibleSources: Map<string, string>,
  passthroughIndex: Map<string, ImageEntry>,
  stagingDir: string,
  variantDir: string,
): Promise<void> {
  if (passthroughIndex.size === 0) return;
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
  }
  for (const outputPath of refs) {
    const src = join(stagingDir, outputPath);
    const dst = join(variantDir, outputPath);
    await mkdir(dirname(dst), { recursive: true });
    try { await copyFile(src, dst); }
    catch (err) {
      console.warn(`  warning: could not copy ${outputPath}: ${(err as Error).message}`);
    }
  }
}

interface FolderIndex {
  path: string;
  title: string;
  markdown: string;
}

/**
 * Build synthesised index.md for any folder (including the root) that has
 * pages but no existing index.md.
 */
function generateFolderIndexes(existing: PageMeta[], _role: string): FolderIndex[] {
  const existingPaths = new Set(existing.map((p) => p.path));

  const folders = new Map<string, { folders: Set<string>; pages: PageMeta[] }>();
  folders.set("", { folders: new Set(), pages: [] });

  for (const page of existing) {
    const parts = page.path.split("/");
    if (parts.length === 1) {
      folders.get("")!.pages.push(page);
      continue;
    }
    for (let i = 0; i < parts.length - 1; i++) {
      const folder = parts.slice(0, i + 1).join("/");
      if (!folders.has(folder)) folders.set(folder, { folders: new Set(), pages: [] });
      const parent = i === 0 ? "" : parts.slice(0, i).join("/");
      folders.get(parent)!.folders.add(parts[i]!);
    }
    const directParent = parts.slice(0, -1).join("/");
    folders.get(directParent)!.pages.push(page);
  }

  const out: FolderIndex[] = [];
  for (const [folder, { folders: subfolders, pages }] of folders) {
    const indexPath = folder === "" ? "index.md" : `${folder}/index.md`;
    if (existingPaths.has(indexPath)) continue;
    if (subfolders.size === 0 && pages.length === 0) continue;

    const title = folder === "" ? "" : folder.split("/").pop()!;
    const sections: string[] = [];

    if (subfolders.size > 0) {
      const sorted = [...subfolders].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }));
      const bullets = sorted.map((sub) => `- [[${folder ? folder + "/" : ""}${sub}/index|${sub}]]`).join("\n");
      sections.push(`## Subfolders\n\n${bullets}`);
    }

    if (pages.length > 0) {
      const columns = chooseColumns(pages);
      const orderYaml = columns.map((c) => `      - ${c}`).join("\n");
      const propsYaml = columns
        .filter((c) => c.startsWith("note."))
        .map((c) => `  ${c}: { displayName: ${prettyLabel(c.slice(5))} }`)
        .join("\n");
      // Filter to direct children of this folder, excluding the auto-
      // generated index page itself. JSON-encode the folder so a name
      // with quotes/special chars survives.
      const folderLiteral = JSON.stringify(folder);
      const filtersBlock = `filters:\n  and:\n    - 'file.folder == ${folderLiteral}'\n    - 'file.name != "index"'`;
      const propsBlock = propsYaml ? `properties:\n${propsYaml}\n` : "";
      sections.push(`## Pages\n\n\`\`\`base\n${filtersBlock}\n${propsBlock}views:\n  - type: table\n    name: Contents\n    order:\n${orderYaml}\n\`\`\``);
    }

    const heading = title ? `# ${title}\n\n` : "";
    out.push({ path: indexPath, title: title || "Home", markdown: `${heading}${sections.join("\n\n")}\n` });
  }
  return out;
}

/**
 * Pick a small set of columns for an auto-generated folder index based on
 * what frontmatter the pages in that folder actually have. The first
 * column is always file.name; we then add any property that's set on
 * ≥ 50% of the folder's pages, capped at 3 extras to keep the table
 * legible. Falls back to file.mtime when no useful frontmatter exists.
 */
function chooseColumns(pages: PageMeta[]): string[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const fm = page.frontmatter ?? {};
    for (const key of Object.keys(fm)) {
      // Skip control / display keys that aren't meaningful as columns.
      if (["title", "role", "aliases", "tags"].includes(key)) continue;
      const v = fm[key];
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.ceil(pages.length / 2);
  const popular = [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([k]) => `note.${k}`);
  return popular.length > 0 ? ["file.name", ...popular] : ["file.name", "file.mtime"];
}

/** snake_case_or-dashed → "Title Cased Words" for column headers. */
function prettyLabel(raw: string): string {
  return raw
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function compressImageCached(
  file: ScannedFile,
  quality: number,
  cacheDir: string,
  onHit: () => void,
): Promise<{ body: Buffer; outputPath: string }> {
  const outputPath = file.path.replace(COMPRESSIBLE_EXT_RE, ".webp");
  const cacheKey = `${file.hash}.webp`;
  const cachePath = join(cacheDir, cacheKey);
  try {
    await stat(cachePath);
    onHit();
    return { body: await readFile(cachePath), outputPath };
  } catch { /* miss */ }

  const compressed = await compressImage(file.absolute, file.path, quality);
  await writeFile(cachePath, compressed.body);
  return { body: compressed.body, outputPath: compressed.outputPath };
}

interface PageFrontmatter { title?: string; role?: string; aliases?: string[]; }

/**
 * Pull the raw `---\n...\n---` frontmatter block out of a markdown source so
 * the layout can show it verbatim (preserving the user's exact formatting,
 * comments, and key order). Returns the inner-block text or null when the
 * page has no frontmatter. The shape `{ frontmatterYaml }` is so callers can
 * spread it directly into the LayoutInput; missing frontmatter contributes
 * nothing to the layout.
 */
function extractFrontmatterBlock(source: string): { frontmatterYaml: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!m || !m[1] || !m[1].trim()) return null;
  return { frontmatterYaml: m[1] };
}

function parseFrontmatter(source: string): PageFrontmatter {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!block) return {};
  const fm = block[1] ?? "";
  const titleMatch = /^title:\s*(.+?)\s*$/m.exec(fm);
  const roleMatch = /^role:\s*(\w+)\s*$/m.exec(fm);
  return {
    ...(titleMatch?.[1] ? { title: titleMatch[1].replace(/^["']|["']$/g, "") } : {}),
    ...(roleMatch?.[1] ? { role: roleMatch[1] } : {}),
    ...({ aliases: parseAliases(fm) }),
  };
}

/**
 * Full YAML frontmatter, used by the Bases plugin so any property a user
 * defines (location, status, npc-class, etc.) is queryable. We delegate
 * to gray-matter so we get real YAML rather than the regex-narrow set
 * `parseFrontmatter` extracts.
 */
function parseFullFrontmatter(source: string): Record<string, unknown> {
  if (!source.startsWith("---")) return {};
  try {
    const data = matter(source).data;
    return (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  } catch {
    // Malformed YAML; the existing parseFrontmatter is more forgiving for
    // the title/role/aliases keys we actually need. Return empty here so
    // the page still renders.
    return {};
  }
}

/**
 * Pull `aliases:` out of frontmatter. Supports the inline form
 * (`aliases: [Foo, Bar]`) and the block form (`aliases:\n- Foo\n- Bar`,
 * indented or not. Obsidian writes both shapes depending on version).
 */
function parseAliases(fm: string): string[] {
  const inline = /^aliases:\s*\[([^\]\n]*)\]\s*$/m.exec(fm);
  if (inline) {
    return inline[1]!.split(",").map((s) => unquote(s.trim())).filter(Boolean);
  }
  const blockHead = /^aliases:\s*$/m.exec(fm);
  if (!blockHead) return [];
  const after = fm.slice(blockHead.index + blockHead[0].length).split("\n");
  const out: string[] = [];
  for (const line of after) {
    if (!line) continue;
    // Allow zero or more leading spaces. Obsidian sometimes writes block
    // arrays without indentation, which strict YAML wouldn't accept but
    // both Obsidian and gray-matter parse fine.
    const item = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (!item) break;
    out.push(unquote(item[1]!));
  }
  return out;
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

function extractH1(source: string): string | null {
  const h1 = /^#\s+(.+)$/m.exec(source);
  return h1?.[1] ? h1[1].trim() : null;
}

function basenameNoExt(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

/**
 * Print a compact summary of render-time warnings (broken wikilinks, missing
 * images, missing transclusions) for the given variant. Truncates at 20
 * pages-with-issues to avoid scrolling off the screen for large vaults.
 */
function reportWarnings(
  role: string,
  rendered: Map<string, { warnings: RenderWarning[] }>,
  allWarnings: boolean | undefined,
): void {
  interface Issue { kind: string; target: string; }
  const issuesByPage = new Map<string, Issue[]>();
  let total = 0;
  for (const [path, info] of rendered) {
    if (info.warnings.length === 0) continue;
    issuesByPage.set(path, info.warnings.map((w) => ({ kind: kindLabel(w.kind), target: w.target })));
    total += info.warnings.length;
  }
  if (total === 0) return;

  const counts: Record<string, number> = {};
  for (const issues of issuesByPage.values()) {
    for (const i of issues) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  }
  const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ");
  console.warn(`  ⚠ ${role}: ${summary} across ${issuesByPage.size} page(s)`);

  const pages = [...issuesByPage].sort((a, b) => a[0].localeCompare(b[0]));
  const shown = allWarnings ? pages : pages.slice(0, 20);
  for (const [path, issues] of shown) {
    console.warn(`    ${path}`);
    const seen = new Set<string>();
    for (const i of issues) {
      const key = `${i.kind}:${i.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.warn(`      ${i.kind}: ${i.target}`);
    }
  }
  if (pages.length > shown.length) {
    console.warn(`    … and ${pages.length - shown.length} more page(s) with warnings (use --all-warnings to show)`);
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "broken-link": return "broken link";
    case "missing-image": return "missing image";
    case "missing-page": return "missing page";
    case "missing-section": return "missing section";
    default: return kind;
  }
}

/**
 * Per-page extension on .body.html manifest entries, consumed by the Foundry
 * sync. Always carries the page's role (so the Foundry side can map roles to
 * JournalEntry ownership against a per-vault dmRole setting); other fields
 * are present only when the corresponding frontmatter is set.
 */
export interface BodyMeta {
  /** Page's resolved role tier (e.g. "public" / "patron" / "dm"). */
  role: string;
  /**
   * Page's display title (frontmatter `title:`, or H1 fallback). Emitted only
   * when it differs from the file's basename — saves a few bytes per page on
   * vaults that don't customise titles. The Foundry side uses this as the
   * JournalEntry/Actor/Item display name; falls back to the basename when
   * absent.
   */
  title?: string;
  /**
   * Foundry document UUID the page should reskin (e.g. "Actor.AbcDef…").
   * The Foundry side runs fromUuid() to resolve this; we don't validate
   * shape here beyond "non-empty string".
   */
  foundry_base?: string;
  /**
   * Arbitrary frontmatter under `foundry:` deep-merged into the target
   * document on update. Lets users override system fields (HP, biography,
   * etc.) without us knowing the system schema.
   */
  foundry?: Record<string, unknown>;
  /** Resolved cover image (served URL). Used as the reskinned actor/item img. */
  image?: string;
}

interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
  mtime: number;
  content_type: string;
  /** Set only on .body.html rows that carry per-page metadata. */
  meta?: BodyMeta;
}

/**
 * Walk the variant directory and produce a manifest of every file with its MD5
 * hash + size + mtime + content type. Shared assets (anything OUTSIDE the
 * variant dir but inside the deploy root) are listed too; clients use a
 * single manifest to diff the entire site, not just the role-specific bits.
 */
async function buildManifest(
  rootDir: string,
  variantDir: string,
  bodyMeta: Map<string, BodyMeta>,
  authRequired: boolean,
  roles: string[],
  vaultName: string,
): Promise<{ name: string; auth: { required: boolean; roles: string[] }; files: ManifestEntry[] }> {
  const files: ManifestEntry[] = [];
  const seen = new Set<string>();

  // Variant-specific files: use pathBase=variantDir so paths come out as
  // "index.html", not "_variants/<role>/index.html". This matches the public
  // URL the client uses; the auth middleware does the variant rewrite.
  await walkAndIndex(variantDir, variantDir, files, seen, [], bodyMeta);

  // Shared assets under the deploy root (attachments, css). Skip the variant
  // tree itself and anything inside `functions/` (Function code isn't served).
  if (rootDir !== variantDir) {
    await walkAndIndex(rootDir, rootDir, files, seen, [
      "_variants", "functions", ".image-staging", ".other-staging",
    ], bodyMeta);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  // `auth.required` lets clients (Foundry, MCP) tell up-front whether the
  // deploy has middleware. Single-role builds collapse to a pure-static
  // deploy with no /_batch / /_connect endpoints — clients fall back to
  // direct CDN GETs in that case. `auth.roles` ships the role order
  // (lowest→highest) so clients can rank a page's tier against a chosen
  // cutoff (e.g. Foundry's per-vault dmRole).
  // `name` is the vault's display name (settings.md `vault_name`); clients
  // like the Foundry module use it as the default label + root folder when
  // a user adds the vault, so they get something readable instead of a
  // host-derived slug.
  return { name: vaultName, auth: { required: authRequired, roles }, files };
}

async function walkAndIndex(
  dir: string,
  pathBase: string,
  out: ManifestEntry[],
  seen: Set<string>,
  skipDirNames: string[],
  bodyMeta: Map<string, BodyMeta>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === "_manifest.json") continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirNames.includes(ent.name)) continue;
      await walkAndIndex(abs, pathBase, out, seen, skipDirNames, bodyMeta);
      continue;
    }
    if (!ent.isFile()) continue;
    const path = relative(pathBase, abs).split(/[/\\]/).join("/");
    if (seen.has(path)) continue;
    seen.add(path);
    const body = await readFile(abs);
    const info = await stat(abs);
    const meta = bodyMeta.get(path);
    // Fold meta JSON into the hash so meta-only edits (e.g. a foundry_base
    // tweak with no body change) still bump the row hash and trigger sync.
    const hasher = createHash("md5").update(body);
    if (meta) hasher.update("\x00meta:" + stableStringify(meta));
    out.push({
      path,
      hash: hasher.digest("hex"),
      size: info.size,
      mtime: Math.floor(info.mtimeMs / 1000),
      content_type: contentTypeForExt(ent.name),
      ...(meta ? { meta } : {}),
    });
  }
}

/**
 * Deterministic JSON encoder. Object keys are sorted recursively so two
 * frontmatters with the same shape but different key order produce the same
 * hash; otherwise the manifest would churn on every YAML reformat.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function contentTypeForExt(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    json: "application/json",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    avif: "image/avif",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Pre-canonicalisation migration. Earlier versions stored roles, auth_type,
 * and role_passwords in settings.md frontmatter; they now live in
 * .vaultrc.json. If we still see them in settings.md (legacy vault), copy
 * over what's missing in .vaultrc.json so the imminent canonicaliser doesn't
 * silently drop them.
 *
 * Idempotent: returns true and logs only if it actually moved something.
 */
async function migrateLegacyAuthFromSettings(vaultPath: string): Promise<boolean> {
  const settingsPath = join(vaultPath, SETTINGS_FILE);
  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch {
    return false;
  }
  const fm = (matter(raw).data ?? {}) as Record<string, unknown>;
  const hasLegacy = "roles" in fm || "auth_type" in fm || "role_passwords" in fm;
  if (!hasLegacy) return false;

  const cfg = await loadConfig(vaultPath, {});
  const moved: string[] = [];

  // roles: only migrate if cfg is still at the default ["public"].
  if (Array.isArray(fm.roles)) {
    const list = fm.roles.filter((r): r is string => typeof r === "string");
    const isDefault = cfg.roles.length === 0 || (cfg.roles.length === 1 && cfg.roles[0] === "public");
    if (list.length > 0 && isDefault && !arraysEqual(list, ["public"])) {
      cfg.roles = list;
      moved.push("roles");
    }
  }
  if (typeof fm.auth_type === "string" && cfg.authType === "password" && fm.auth_type !== "password") {
    cfg.authType = fm.auth_type;
    moved.push("auth_type");
  }
  if (fm.role_passwords && typeof fm.role_passwords === "object" && !Array.isArray(fm.role_passwords)
      && Object.keys(cfg.rolePasswords).length === 0) {
    const map = fm.role_passwords as Record<string, unknown>;
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) if (typeof v === "string") cleaned[k] = v;
    if (Object.keys(cleaned).length > 0) {
      cfg.rolePasswords = cleaned;
      moved.push("role_passwords");
    }
  }

  if (moved.length === 0) return false;
  await saveConfig(vaultPath, cfg);
  console.log(`  migrated ${moved.join(", ")} from settings.md → .vaultrc.json`);
  return true;
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function extractPlainText(source: string, max: number): string {
  return source
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[\[[^\]]+\]\]/g, "")
    .replace(/\[\[([^\]|#]+)(?:[#|][^\]]+)?\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]+([^*_~\n]+)[*_~]+/g, "$1")
    .replace(/^>\s?\[![^\]]+\][+-]?\s*(.*)$/gm, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
