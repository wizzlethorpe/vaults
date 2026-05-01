import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { availableParallelism } from "node:os";
import picomatch from "picomatch";
import { scanVault, type ScannedFile } from "./scan.js";
import { compressImage, COMPRESSIBLE_EXT_RE } from "./images.js";
import { renderMarkdown } from "./render/pipeline.js";
import { renderLayout } from "./render/layout.js";
import { slugify } from "./render/slug.js";
import { buildPreview } from "./render/preview.js";
import { DEFAULT_CSS } from "./render/styles.js";
import { loadObsidianSnippets } from "./obsidian.js";
import { loadSettings, writeSettings, SETTINGS_FILE, type Settings } from "./settings.js";
import { renderAuthMiddleware, LOGIN_HTML } from "./render/auth-template.js";
import type { ImageEntry, PageMeta, RenderContext } from "./render/types.js";
import { formatDuration, pMap, Progress } from "./util.js";

export interface BuildOptions {
  vaultPath: string;
  outputDir: string;
  vaultName: string;
  imageQuality: number;
  maxFileBytes: number;
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

  // ── Settings ─────────────────────────────────────────────────────────────
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

  const roles = settings.values.roles.length > 0 ? settings.values.roles : ["public"];
  const defaultRole = roles[0]!;
  const allRoleSet = new Set(roles);

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
  const imageFiles = withinLimit.filter((f) => COMPRESSIBLE_EXT_RE.test(f.path));
  const otherFiles = withinLimit.filter(
    (f) => !/\.md$/i.test(f.path) && !COMPRESSIBLE_EXT_RE.test(f.path),
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

  // ── Image compression (shared across all variants) ──────────────────────
  const imageIndex = new Map<string, ImageEntry>();
  if (imageFiles.length > 0) {
    const cacheDir = join(opts.vaultPath, ".vault-cache", "images", `q${opts.imageQuality}`);
    await mkdir(cacheDir, { recursive: true });
    let cacheHits = 0;
    const progress = new Progress("Images");
    progress.update(0, imageFiles.length);

    await pMap(imageFiles, concurrency, async (f) => {
      const compressed = opts.imageQuality > 0
        ? await compressImageCached(f, opts.imageQuality, cacheDir, () => { cacheHits++; })
        : { body: await readFile(f.absolute), outputPath: f.path };

      const dest = join(opts.outputDir, compressed.outputPath);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, compressed.body);

      imageIndex.set(slugify(f.path.split("/").pop()!), {
        sourcePath: f.path,
        outputPath: compressed.outputPath,
      });
    }, (done, total) => progress.update(done, total));

    progress.done(`${imageFiles.length} processed (${cacheHits} cached, ${imageFiles.length - cacheHits} compressed)`);
  }

  // ── Passthrough files (shared) ──────────────────────────────────────────
  if (otherFiles.length > 0) {
    const progress = new Progress("Other");
    progress.update(0, otherFiles.length);
    await pMap(otherFiles, concurrency, async (f) => {
      const dest = join(opts.outputDir, f.path);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(f.absolute, dest);
    }, (done, total) => progress.update(done, total));
    progress.done(`${otherFiles.length} copied`);
  }

  // Shared CSS bundle
  await writeFile(join(opts.outputDir, "styles.css"), DEFAULT_CSS);
  const userCss = await loadObsidianSnippets(opts.vaultPath);
  await writeFile(join(opts.outputDir, "user.css"), userCss);
  if (userCss) console.log(`  loaded user.css from .obsidian/snippets/`);

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
      settings: settings.values,
      concurrency,
    });
    perRolePageCount[role] = stats.pageCount;
    if (!collapseToRoot) console.log(`  variant '${role}': ${stats.pageCount} pages`);
  }

  // ── Auth Function (multi-role only) ─────────────────────────────────────
  if (!collapseToRoot) {
    const fnDir = join(opts.outputDir, "functions");
    await mkdir(fnDir, { recursive: true });
    const middleware = renderAuthMiddleware({
      roles,
      rolePasswords: settings.values.role_passwords,
    });
    await writeFile(join(fnDir, "_middleware.js"), middleware);

    // Login page — drop in the role list (everything above the default).
    const protectedRoles = roles.slice(1);
    const opts_html = protectedRoles
      .map((r) => `<option value="${r}">${r}</option>`)
      .join("");
    await writeFile(join(opts.outputDir, "login.html"), LOGIN_HTML.replace("__ROLE_OPTIONS__", opts_html));

    const missing = protectedRoles.filter((r) => !settings.values.role_passwords[r]);
    if (missing.length > 0) {
      console.warn(`  WARNING: no password set for role(s): ${missing.join(", ")}. Run 'vaults password <role>' before pushing.`);
    }
  }

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
  settings: Settings;
  concurrency: number;
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

  // Pass 1: render bodies + collect outlinks.
  interface Rendered { title: string; html: string; outlinks: string[]; }
  const rendered = new Map<string, Rendered>();

  const progress = new Progress(`Pages (${a.role})`);
  progress.update(0, visibleMetas.length);
  await pMap(visibleMetas, a.concurrency, async (p) => {
    const result = await renderMarkdown(visibleSources.get(p.path)!, context, basenameNoExt(p.path));
    rendered.set(p.path, { title: result.title, html: result.html, outlinks: result.outlinks });
  }, (done, total) => progress.update(done, total));

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
      ...(p.mtime != null ? { mtime: p.mtime } : {}),
      ...(p.birthtime != null ? { birthtime: p.birthtime } : {}),
    });
    const outputBase = p.path.replace(/\.md$/i, "");
    const dest = join(a.variantDir, outputBase + ".html");
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, html);

    const preview = await buildPreview(visibleSources.get(p.path)!, r.title);
    await writeFile(join(a.variantDir, outputBase + ".preview.json"), JSON.stringify(preview));
  });

  progress.done(`${visibleMetas.length} rendered`);

  // Per-variant search index.
  const searchIndex = visibleMetas.map((p) => ({
    title: p.title,
    path: p.path,
    href: "/" + p.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/"),
    folder: p.path.includes("/") ? p.path.split("/").slice(0, -1).join("/") : "",
    text: extractPlainText(visibleSources.get(p.path) ?? "", 1500),
  }));
  await writeFile(join(a.variantDir, "_search-index.json"), JSON.stringify(searchIndex));

  return { pageCount: visibleMetas.length };
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
