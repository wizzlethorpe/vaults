import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { availableParallelism } from "node:os";
import { scanVault, type ScannedFile } from "./scan.js";
import { compressImage, contentTypeFor, COMPRESSIBLE_EXT_RE } from "./images.js";
import { renderMarkdown } from "./render/pipeline.js";
import { renderLayout } from "./render/layout.js";
import { slugify } from "./render/slug.js";
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

  console.log(`Scanning ${opts.vaultPath}...`);
  const scanStart = Date.now();
  const files = await scanVault(opts.vaultPath);
  console.log(`  found ${files.length} files in ${formatDuration(Date.now() - scanStart)}`);

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

  // Build the page index for wikilink resolution
  const pageMetas: PageMeta[] = [];
  for (const f of markdownFiles) {
    const title = await pageTitle(f);
    pageMetas.push({ path: f.path, title });
  }
  const pageIndex = new Map(pageMetas.map((p) => [slugify(p.path.split("/").pop()!), p]));

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

  const context: RenderContext = { pages: pageIndex, images: imageIndex };

  // Render markdown pages (parallel)
  if (markdownFiles.length > 0) {
    const progress = new Progress("Pages");
    progress.update(0, markdownFiles.length);

    await pMap(markdownFiles, concurrency, async (f) => {
      const source = await readFile(f.absolute, "utf8");
      const result = await renderMarkdown(source, context, basenameNoExt(f.path));
      const html = renderLayout({
        title: result.title,
        pagePath: f.path,
        bodyHtml: result.html,
        pages: pageMetas,
        vaultName: opts.vaultName,
      });
      const dest = join(opts.outputDir, f.path.replace(/\.md$/i, ".html"));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, html);
    }, (done, total) => progress.update(done, total));

    progress.done(`${markdownFiles.length} rendered`);
  }

  // Copy passthrough files (PDFs, audio, etc.) — parallel
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

  await writeFile(join(opts.outputDir, "styles.css"), DEFAULT_CSS);

  console.log(`Built in ${formatDuration(Date.now() - start)}.`);

  return {
    files,
    withinLimit,
    pageCount: markdownFiles.length,
    imageCount: imageFiles.length,
    otherCount: otherFiles.length,
  };
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
  } catch {
    // Cache miss — compress and store
  }

  const compressed = await compressImage(file.absolute, file.path, quality);
  await writeFile(cachePath, compressed.body);
  return { body: compressed.body, outputPath: compressed.outputPath };
}

async function pageTitle(file: ScannedFile): Promise<string> {
  const raw = await readFile(file.absolute, "utf8");
  const fmTitle = /^---[\s\S]*?\ntitle:\s*(.+?)\s*\n[\s\S]*?\n---/.exec(raw);
  if (fmTitle?.[1]) return fmTitle[1].replace(/^["']|["']$/g, "");
  const h1 = /^#\s+(.+)$/m.exec(raw);
  if (h1?.[1]) return h1[1].trim();
  return basenameNoExt(file.path);
}

function basenameNoExt(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

const DEFAULT_CSS = `:root {
  --bg: #fafaf9; --fg: #2a2a2a; --muted: #888; --link: #0066cc; --accent: #6b46c1;
  --border: #e5e5e5; --code-bg: #f4f4f4;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; line-height: 1.6; color: var(--fg); background: var(--bg); }
.site-header { padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); }
.site-name { font-weight: 600; color: var(--fg); text-decoration: none; }
.layout { display: grid; grid-template-columns: 220px 1fr; gap: 2rem; max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }
.sidebar-left { font-size: 0.85rem; }
.sitemap { list-style: none; padding: 0; margin: 0; }
.sitemap a { display: block; padding: 0.15rem 0.4rem; color: var(--muted); text-decoration: none; border-radius: 3px; }
.sitemap a:hover { color: var(--fg); background: rgba(107,70,193,0.05); }
.sitemap a[aria-current="page"] { color: var(--accent); font-weight: 600; }
.sitemap-folder summary { padding: 0.15rem 0.4rem; cursor: pointer; color: var(--muted); font-weight: 500; }
.sitemap-folder ul { padding-left: 0.85rem; }
.content { min-width: 0; }
.breadcrumbs { font-size: 0.85rem; color: var(--muted); margin-bottom: 1rem; }
.breadcrumbs a { color: var(--muted); text-decoration: none; }
.breadcrumbs a:hover { color: var(--link); }
.bc-sep { padding: 0 0.4rem; }
.page-title { margin: 0 0 1.5rem; font-size: 1.8rem; }
.content a { color: var(--link); }
.content a.broken { color: #c0392b; text-decoration: underline wavy; }
.content img { max-width: 100%; border-radius: 4px; }
.content code { background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
.content pre { background: var(--code-bg); padding: 1rem; border-radius: 6px; overflow-x: auto; }
.content pre code { background: none; padding: 0; }
.content blockquote { margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid var(--border); color: var(--muted); }
@media (max-width: 720px) { .layout { grid-template-columns: 1fr; } .sidebar-left { display: none; } }
`;
