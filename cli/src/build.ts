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
import { loadSettings, writeSettings, SETTINGS_FILE } from "./settings.js";
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
  pageCount: number;
  imageCount: number;
  otherCount: number;
}

export async function buildSite(opts: BuildOptions): Promise<BuildResult> {
  const start = Date.now();
  const concurrency = Math.max(2, availableParallelism());

  // settings.md (frontmatter-only file in the vault root) overrides the build
  // options for the few settings it covers. CLI flags still win — they were
  // passed in BuildOptions explicitly. If the file already exists and has
  // drifted from canonical (unknown keys, missing keys, stale formatting),
  // rewrite it so the user sees consistent output as the schema evolves.
  // We don't auto-create the file when it's missing — that's `init`'s job.
  const settings = await loadSettings(opts.vaultPath);
  for (const w of settings.warnings) console.warn(`  ${w}`);
  if (settings.exists && settings.changed) {
    await writeSettings(opts.vaultPath, settings.values);
    console.log(`  rewrote ${SETTINGS_FILE} to canonical format`);
  }
  const effective: BuildOptions = {
    ...opts,
    vaultName: opts.vaultName === "Vault" ? settings.values.vault_name : opts.vaultName,
    imageQuality: opts.imageQuality === 85 ? settings.values.image_quality : opts.imageQuality,
    maxFileBytes: opts.maxFileBytes === 25 * 1024 * 1024 ? settings.values.max_file_bytes : opts.maxFileBytes,
  };
  opts = effective;

  console.log(`Scanning ${opts.vaultPath}...`);
  const scanStart = Date.now();
  const allFiles = await scanVault(opts.vaultPath);
  // settings.md is CLI config, not content. Also drop anything matching the
  // user's ignore globs (settings.ignore from settings.md).
  const ignoreMatchers = settings.values.ignore.map((p) => picomatch(p));
  const isIgnored = (path: string) => ignoreMatchers.some((m) => m(path));
  const files = allFiles.filter((f) => f.path !== SETTINGS_FILE && !isIgnored(f.path));
  const ignoredCount = allFiles.length - files.length - 1; // subtract the settings.md itself
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

  // Pre-load all markdown content (used for titles, transclusion, previews).
  const sources = new Map<string, string>();
  await pMap(markdownFiles, concurrency, async (f) => {
    sources.set(f.path, await readFile(f.absolute, "utf8"));
  });

  // Build the page index (slug → meta) for wikilink resolution
  const pageMetas: PageMeta[] = markdownFiles.map((f) => ({
    path: f.path,
    title: pageTitle(sources.get(f.path)!, f.path),
    mtime: f.mtime,
    birthtime: f.birthtime,
  }));

  // Identify folders that don't have an index.md and synthesize one
  const folderIndexes = generateFolderIndexes(pageMetas);
  for (const fi of folderIndexes) {
    pageMetas.push({ path: fi.path, title: fi.title });
    sources.set(fi.path, fi.markdown);
  }

  // Page index supports BOTH basename lookups ([[Aghash]]) and full-path lookups
  // ([[NPCs/Aghash]], [[NPCs/index]]). Multiple folder indexes share basename "index"
  // so the full-path key is what disambiguates them.
  const pageIndex = new Map<string, PageMeta>();
  const markdownContent = new Map<string, string>();
  for (const p of pageMetas) {
    const basenameSlug = slugify(p.path.split("/").pop()!);
    const pathSlug = slugify(p.path.replace(/\.md$/i, ""));
    // Don't let folder-index basename collisions overwrite earlier basename entries
    if (!pageIndex.has(basenameSlug)) pageIndex.set(basenameSlug, p);
    pageIndex.set(pathSlug, p);
    markdownContent.set(basenameSlug, sources.get(p.path)!);
    markdownContent.set(pathSlug, sources.get(p.path)!);
  }

  // Compress images (with cache + parallelism)
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

  const context: RenderContext = { pages: pageIndex, images: imageIndex, markdownContent };

  // Render markdown pages + write preview JSON (parallel)
  if (pageMetas.length > 0) {
    const progress = new Progress("Pages");
    progress.update(0, pageMetas.length);

    await pMap(pageMetas, concurrency, async (p) => {
      const source = sources.get(p.path)!;
      const result = await renderMarkdown(source, context, basenameNoExt(p.path));
      const html = renderLayout({
        title: result.title,
        pagePath: p.path,
        bodyHtml: result.html,
        pages: pageMetas,
        vaultName: opts.vaultName,
        inlineTitle: settings.values.inline_title,
        ...(p.mtime != null ? { mtime: p.mtime } : {}),
        ...(p.birthtime != null ? { birthtime: p.birthtime } : {}),
      });
      const outputBase = p.path.replace(/\.md$/i, "");
      const dest = join(opts.outputDir, outputBase + ".html");
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, html);

      // Per-page preview JSON for hover popovers
      const preview = await buildPreview(source, result.title);
      await writeFile(join(opts.outputDir, outputBase + ".preview.json"), JSON.stringify(preview));
    }, (done, total) => progress.update(done, total));

    progress.done(`${pageMetas.length} rendered (${markdownFiles.length} from source, ${folderIndexes.length} folder indexes)`);
  }

  // Copy passthrough files
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

  // Write search index
  const searchIndex = pageMetas.map((p) => ({
    title: p.title,
    path: p.path,
    href: "/" + p.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/"),
    folder: p.path.includes("/") ? p.path.split("/").slice(0, -1).join("/") : "",
  }));
  await writeFile(join(opts.outputDir, "_search-index.json"), JSON.stringify(searchIndex));

  await writeFile(join(opts.outputDir, "styles.css"), DEFAULT_CSS);

  // Pull in user-authored Obsidian CSS snippets (.obsidian/snippets/*.css).
  // Filtered by .obsidian/appearance.json's enabledCssSnippets if present.
  const userCss = await loadObsidianSnippets(opts.vaultPath);
  await writeFile(join(opts.outputDir, "user.css"), userCss);
  if (userCss) console.log(`  loaded user.css from .obsidian/snippets/`);

  console.log(`Built in ${formatDuration(Date.now() - start)}.`);
  return {
    files,
    withinLimit,
    pageCount: pageMetas.length,
    imageCount: imageFiles.length,
    otherCount: otherFiles.length,
  };
}

interface FolderIndex {
  path: string;          // synthetic, e.g. "NPCs/index.md"
  title: string;
  markdown: string;       // generated source — gets rendered like any other page
}

/**
 * Build synthesised index.md for any folder (including the root) that has
 * pages but no existing index.md. Each generated index lists its direct
 * children (subfolders + pages) as wikilinks.
 */
function generateFolderIndexes(existing: PageMeta[]): FolderIndex[] {
  const existingPaths = new Set(existing.map((p) => p.path));

  // Collect folder → direct children
  const folders = new Map<string, { folders: Set<string>; pages: PageMeta[] }>();
  // Root entry
  folders.set("", { folders: new Set(), pages: [] });

  for (const page of existing) {
    const parts = page.path.split("/");
    if (parts.length === 1) {
      folders.get("")!.pages.push(page);
      continue;
    }
    // Each ancestor folder learns about its immediate child
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
      const sorted = [...subfolders].sort((a, b) => a.localeCompare(b));
      for (const sub of sorted) lines.push(`- [[${folder ? folder + "/" : ""}${sub}/index|${sub}]]`);
    }
    if (pages.length > 0) {
      lines.push("");
      const sorted = [...pages].sort((a, b) => a.title.localeCompare(b.title));
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

function pageTitle(source: string, path: string): string {
  const fmTitle = /^---[\s\S]*?\ntitle:\s*(.+?)\s*\n[\s\S]*?\n---/.exec(source);
  if (fmTitle?.[1]) return fmTitle[1].replace(/^["']|["']$/g, "");
  const h1 = /^#\s+(.+)$/m.exec(source);
  if (h1?.[1]) return h1[1].trim();
  return basenameNoExt(path);
}

function basenameNoExt(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}
