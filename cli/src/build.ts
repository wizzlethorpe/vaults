import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { dirname, join } from "node:path";
import { availableParallelism } from "node:os";
import picomatch from "picomatch";
import { scanVault, type ScannedFile } from "./scan.js";
import { compressImage, COMPRESSIBLE_EXT_RE } from "./images.js";
import { buildFavicon } from "./favicon.js";

// Any image format that can be referenced via ![[name.ext]] — superset of
// COMPRESSIBLE_EXT_RE since SVGs/GIFs ship as-is rather than being recoded.
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|tiff?)$/i;
import { renderMarkdown } from "./render/pipeline.js";
import { renderLayout, render404 } from "./render/layout.js";
import { slugify } from "./render/slug.js";
import { buildPreview } from "./render/preview.js";
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
  const otherFiles = withinLimit.filter(
    (f) => !/\.md$/i.test(f.path) && !IMAGE_EXT_RE.test(f.path),
  );

  // ── Shared content (read once, reused across roles) ─────────────────────
  const sources = new Map<string, string>();
  await pMap(markdownFiles, concurrency, async (f) => {
    sources.set(f.path, await readFile(f.absolute, "utf8"));
  });

  // Parse role + title per page. Pages with an unrecognised role fall back to
  // the default with a warning — better than silently dropping them.
  const allPageMetas: PageMeta[] = markdownFiles.map((f) => {
    const src = sources.get(f.path)!;
    const meta = parseFrontmatter(src);
    let role = meta.role ?? defaultRole;
    if (!allRoleSet.has(role)) {
      console.warn(`  ${f.path}: role "${role}" not in settings.roles, using "${defaultRole}"`);
      role = defaultRole;
    }
    return {
      path: f.path,
      title: meta.title ?? extractH1(src) ?? basenameNoExt(f.path),
      role,
      mtime: f.mtime,
      birthtime: f.birthtime,
    };
  });

  // ── Image compression (staged; copied per-variant later) ────────────────
  // Compress once into a private staging dir under the deploy root. Each
  // variant's render pass copies whichever images its visible pages
  // reference. The staging dir is removed at the end so images only ship
  // to the variants that need them — that's how DM-only art is kept off
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

  // ── Passthrough files (PDFs, audio, etc.) ───────────────────────────────
  // Staged once, copied into every variant. We don't scan markdown to find
  // out which files are referenced (links can be plain text, embedded HTML,
  // or arbitrary URLs), so we ship them into every tier — the trade-off is
  // that DM-only PDFs are reachable from any role's deploy. Document as a
  // known limitation.
  const otherStagingDir = join(opts.outputDir, ".other-staging");
  if (otherFiles.length > 0) {
    const progress = new Progress("Other");
    progress.update(0, otherFiles.length);
    await pMap(otherFiles, concurrency, async (f) => {
      const dest = join(otherStagingDir, f.path);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(f.absolute, dest);
    }, (done, total) => progress.update(done, total));
    progress.done(`${otherFiles.length} copied`);
  }

  // Shared CSS bundle
  const themeOverride = renderThemeOverride({
    lightAccent: settings.values.accent_color,
    darkAccent: settings.values.accent_color_dark,
  });
  await writeFile(join(opts.outputDir, "styles.css"), DEFAULT_CSS + themeOverride);
  const userCss = await loadObsidianSnippets(opts.vaultPath);
  await writeFile(join(opts.outputDir, "user.css"), userCss);
  if (userCss) console.log(`  loaded user.css from .obsidian/snippets/`);

  // Favicon — either user-supplied via settings.favicon, or a generated
  // default with the vault's first letter on the accent colour.
  try {
    const favicon = await buildFavicon({
      vaultPath: opts.vaultPath,
      faviconPath: settings.values.favicon,
      letter: (opts.vaultName || "V").trim().charAt(0).toUpperCase() || "V",
      accentColor: settings.values.accent_color || "#a8201a",
    });
    await writeFile(join(opts.outputDir, "favicon.ico"), favicon);
  } catch (err) {
    console.warn(`  warning: could not generate favicon: ${(err as Error).message}`);
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
      imageIndex,
      imageStagingDir,
      otherFiles,
      otherStagingDir,
      settings: settings.values,
      authConfigured: roles.length > 1,
      concurrency,
      allWarnings: opts.allWarnings,
    });
    perRolePageCount[role] = stats.pageCount;
    if (!collapseToRoot) console.log(`  variant '${role}': ${stats.pageCount} pages`);

    // Write a per-variant _manifest.json so external clients (Foundry, MCP,
    // etc.) can do an incremental diff. Includes EVERY file that variant
    // serves — html, md, images (as relative paths into shared root), css.
    const manifest = await buildManifest(opts.outputDir, variantDir);
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

    // Login page — drop in the role list (everything above the default).
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

  // Drop the staging dirs — their contents have been copied into each
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
    otherCount: otherFiles.length,
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
  imageIndex: Map<string, ImageEntry>;
  /** Staging dir holding compressed images; we copy what's referenced. */
  imageStagingDir: string;
  /** Passthrough files (PDFs, audio, etc.) staged once, copied per variant. */
  otherFiles: ScannedFile[];
  otherStagingDir: string;
  settings: Settings;
  /** Whether the deployment has more than one role (controls auth-box rendering). */
  authConfigured: boolean;
  concurrency: number;
  allWarnings: boolean | undefined;
}

interface VariantStats { pageCount: number; }

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

  // Per-variant page index for wikilink resolution. Both basename and full-path
  // slugs are keyed; folder-index basenames don't overwrite earlier entries.
  const pageIndex = new Map<string, PageMeta>();
  const markdownContent = new Map<string, string>();
  for (const p of visibleMetas) {
    const basenameSlug = slugify(p.path.split("/").pop()!);
    const pathSlug = slugify(p.path.replace(/\.md$/i, ""));
    if (!pageIndex.has(basenameSlug)) pageIndex.set(basenameSlug, p);
    pageIndex.set(pathSlug, p);
    markdownContent.set(basenameSlug, visibleSources.get(p.path)!);
    markdownContent.set(pathSlug, visibleSources.get(p.path)!);
  }

  const context: RenderContext = {
    pages: pageIndex,
    images: a.imageIndex,
    markdownContent,
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
    });
    const outputBase = p.path.replace(/\.md$/i, "");
    const htmlDest = join(a.variantDir, outputBase + ".html");
    await mkdir(dirname(htmlDest), { recursive: true });
    await writeFile(htmlDest, html);

    // .body.html holds just the rendered article content (no layout shell).
    // Foundry imports this so callouts/embeds rendered by the vault's
    // remark/rehype pipeline land in journals as-is, no client-side render.
    await writeFile(join(a.variantDir, outputBase + ".body.html"), r.html);

    const source = visibleSources.get(p.path)!;
    const preview = await buildPreview(source, r.title);
    await writeFile(join(a.variantDir, outputBase + ".preview.json"), JSON.stringify(preview));
  });

  progress.done(`${visibleMetas.length} rendered`);

  // 404 page using the same layout shell — middleware fetches this when a
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
  // the public wiki structurally 404s.
  await copyReferencedImages(visibleSources, a.imageIndex, a.imageStagingDir, a.variantDir);

  // Passthrough files (PDFs, audio, etc.) ship into every variant — the
  // build doesn't scan markdown for arbitrary references, so we can't tell
  // which role-restricted pages link to a given PDF. Limitation: DM-only
  // data files in this category aren't role-gated.
  for (const f of a.otherFiles) {
    const src = join(a.otherStagingDir, f.path);
    const dst = join(a.variantDir, f.path);
    await mkdir(dirname(dst), { recursive: true });
    try { await copyFile(src, dst); }
    catch (err) {
      console.warn(`  warning: could not copy ${f.path}: ${(err as Error).message}`);
    }
  }

  return { pageCount: visibleMetas.length };
}

const EMBED_RE = /!\[\[([^\[\]|#\n]+?)(?:\|[^\[\]#\n]*)?\]\]/g;

async function copyReferencedImages(
  visibleSources: Map<string, string>,
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

    const title = folder === "" ? "" : folder.split("/").pop()!;
    const lines: string[] = [];
    if (subfolders.size > 0) {
      lines.push("");
      const sorted = [...subfolders].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }));
      for (const sub of sorted) lines.push(`- [[${folder ? folder + "/" : ""}${sub}/index|${sub}]]`);
    }
    if (pages.length > 0) {
      lines.push("");
      const sorted = [...pages].sort((x, y) => x.title.localeCompare(y.title, undefined, { numeric: true, sensitivity: "base" }));
      for (const p of sorted) lines.push(`- [[${p.path.replace(/\.md$/i, "")}|${p.title}]]`);
    }
    if (subfolders.size === 0 && pages.length === 0) continue;

    const heading = title ? `# ${title}\n` : "";
    out.push({ path: indexPath, title: title || "Home", markdown: `${heading}${lines.join("\n")}\n` });
  }
  return out;
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

interface PageFrontmatter { title?: string; role?: string; }

function parseFrontmatter(source: string): PageFrontmatter {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!block) return {};
  const fm = block[1] ?? "";
  const titleMatch = /^title:\s*(.+?)\s*$/m.exec(fm);
  const roleMatch = /^role:\s*(\w+)\s*$/m.exec(fm);
  return {
    ...(titleMatch?.[1] ? { title: titleMatch[1].replace(/^["']|["']$/g, "") } : {}),
    ...(roleMatch?.[1] ? { role: roleMatch[1] } : {}),
  };
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

interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
  mtime: number;
  content_type: string;
}

/**
 * Walk the variant directory and produce a manifest of every file with its MD5
 * hash + size + mtime + content type. Shared assets (anything OUTSIDE the
 * variant dir but inside the deploy root) are listed too — clients use a
 * single manifest to diff the entire site, not just the role-specific bits.
 */
async function buildManifest(rootDir: string, variantDir: string): Promise<{ files: ManifestEntry[] }> {
  const files: ManifestEntry[] = [];
  const seen = new Set<string>();

  // Variant-specific files: use pathBase=variantDir so paths come out as
  // "index.html", not "_variants/<role>/index.html". This matches the public
  // URL the client uses; the auth middleware does the variant rewrite.
  await walkAndIndex(variantDir, variantDir, files, seen);

  // Shared assets under the deploy root (attachments, css). Skip the variant
  // tree itself and anything inside `functions/` (Function code isn't served).
  if (rootDir !== variantDir) {
    await walkAndIndex(rootDir, rootDir, files, seen, [
      "_variants", "functions", ".image-staging", ".other-staging",
    ]);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}

async function walkAndIndex(
  dir: string,
  pathBase: string,
  out: ManifestEntry[],
  seen: Set<string>,
  skipDirNames: string[] = [],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === "_manifest.json") continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirNames.includes(ent.name)) continue;
      await walkAndIndex(abs, pathBase, out, seen, skipDirNames);
      continue;
    }
    if (!ent.isFile()) continue;
    const path = relative(pathBase, abs).split(/[/\\]/).join("/");
    if (seen.has(path)) continue;
    seen.add(path);
    const body = await readFile(abs);
    const info = await stat(abs);
    out.push({
      path,
      hash: createHash("md5").update(body).digest("hex"),
      size: info.size,
      mtime: Math.floor(info.mtimeMs / 1000),
      content_type: contentTypeForExt(ent.name),
    });
  }
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
