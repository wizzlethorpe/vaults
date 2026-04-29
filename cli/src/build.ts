import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { scanVault, type ScannedFile } from "./scan.js";
import { compressImage, contentTypeFor, COMPRESSIBLE_EXT_RE } from "./images.js";
import { renderMarkdown } from "./render/pipeline.js";
import { renderLayout } from "./render/layout.js";
import { slugify } from "./render/slug.js";
import type { ImageEntry, PageMeta, RenderContext } from "./render/types.js";

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

/**
 * Renders the entire vault to a local output directory. Used by `build`,
 * `preview`, and `push`.
 */
export async function buildSite(opts: BuildOptions): Promise<BuildResult> {
  const files = await scanVault(opts.vaultPath);

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

  // Build the page index (slug → meta) for wikilink resolution
  const pageMetas: PageMeta[] = [];
  for (const f of markdownFiles) {
    const title = await pageTitle(f);
    pageMetas.push({ path: f.path, title });
  }
  const pageIndex = new Map(pageMetas.map((p) => [slugify(p.path.split("/").pop()!), p]));

  // Compress images (or copy verbatim if quality=0) and build the image index
  const imageIndex = new Map<string, ImageEntry>();
  for (const f of imageFiles) {
    const compressed = opts.imageQuality > 0
      ? await compressImage(f.absolute, f.path, opts.imageQuality)
      : { body: await readFile(f.absolute), contentType: contentTypeFor(f.path), outputPath: f.path };

    const dest = join(opts.outputDir, compressed.outputPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, compressed.body);

    imageIndex.set(slugify(f.path.split("/").pop()!), {
      sourcePath: f.path,
      outputPath: compressed.outputPath,
    });
  }

  const context: RenderContext = { pages: pageIndex, images: imageIndex };

  for (const f of markdownFiles) {
    const source = await readFile(f.absolute, "utf8");
    const result = await renderMarkdown(source, context, basenameNoExt(f.path));
    const html = renderLayout({
      title: result.title,
      pagePath: f.path,
      bodyHtml: result.html,
      pages: pageMetas,
      vaultName: opts.vaultName,
    });
    const outputName = f.path.replace(/\.md$/i, ".html");
    const dest = join(opts.outputDir, outputName);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, html);
  }

  for (const f of otherFiles) {
    const dest = join(opts.outputDir, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(f.absolute));
  }

  await writeFile(join(opts.outputDir, "styles.css"), DEFAULT_CSS);

  return {
    files,
    withinLimit,
    pageCount: markdownFiles.length,
    imageCount: imageFiles.length,
    otherCount: otherFiles.length,
  };
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
