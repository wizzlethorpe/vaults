import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { ApiClient } from "../api.js";
import { loadConfig } from "../config.js";
import { scanVault, type ScannedFile } from "../scan.js";
import { compressImage, contentTypeFor, COMPRESSIBLE_EXT_RE } from "../images.js";
import { renderMarkdown } from "../render/pipeline.js";
import { renderLayout } from "../render/layout.js";
import { slugify } from "../render/slug.js";
import type { ImageEntry, PageMeta, RenderContext } from "../render/types.js";

interface PushOptions {
  url?: string;
  key?: string;
  projectName?: string;
  imageQuality?: number;
  vaultName?: string;
  dryRun?: boolean;
}

export async function push(vaultPath: string, opts: PushOptions): Promise<void> {
  const cfg = await loadConfig(vaultPath, {
    ...(opts.url ? { url: opts.url } : {}),
    ...(opts.key ? { apiKey: opts.key } : {}),
    ...(opts.projectName ? { projectName: opts.projectName } : {}),
    ...(opts.imageQuality != null ? { imageQuality: opts.imageQuality } : {}),
  });

  const api = new ApiClient(cfg);
  const vaultName = opts.vaultName ?? "Vault";

  console.log(`Scanning ${vaultPath}...`);
  const files = await scanVault(vaultPath);
  console.log(`  found ${files.length} files`);

  // Filter out files exceeding the size cap (warn, then drop)
  const withinLimit = files.filter((f) => {
    if (f.size > cfg.maxFileBytes) {
      console.warn(`  skipping ${f.path} (${f.size} bytes > ${cfg.maxFileBytes} limit)`);
      return false;
    }
    return true;
  });

  // Sync source files: diff against server manifest, push changed/new, delete removed
  await syncSource(api, withinLimit, opts.dryRun ?? false);

  // Render the static site to a local output dir and deploy via wrangler
  const outputDir = join(vaultPath, ".vault-cache", "rendered");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await renderSite(withinLimit, outputDir, vaultName, cfg.imageQuality);

  if (opts.dryRun) {
    console.log(`Dry run complete. Rendered output is in ${outputDir}.`);
    return;
  }

  if (cfg.projectName) {
    await wranglerDeploy(outputDir, cfg.projectName);
  } else {
    console.log(`Rendered to ${outputDir}. Set 'projectName' in config to auto-deploy.`);
  }
}

async function syncSource(api: ApiClient, files: ScannedFile[], dryRun: boolean): Promise<void> {
  console.log("Fetching server manifest...");
  const manifest = await api.getManifest();
  const remote = new Map(manifest.map((m) => [m.path, m]));

  const toUpload: ScannedFile[] = [];
  for (const f of files) {
    const r = remote.get(f.path);
    if (!r || r.etag.replace(/^"|"$/g, "") !== f.hash) toUpload.push(f);
  }
  const localPaths = new Set(files.map((f) => f.path));
  const toDelete = manifest.map((m) => m.path).filter((p) => !localPaths.has(p));

  console.log(`  ${toUpload.length} to upload, ${toDelete.length} to delete, ${files.length - toUpload.length} unchanged`);
  if (dryRun) return;

  for (const f of toUpload) {
    const body = await readFile(f.absolute);
    await api.putSource(f.path, body, contentTypeFor(f.path));
    process.stdout.write(`  ↑ ${f.path}\n`);
  }
  for (const path of toDelete) {
    await api.deleteSource(path);
    process.stdout.write(`  − ${path}\n`);
  }
}

async function renderSite(
  files: ScannedFile[],
  outputDir: string,
  vaultName: string,
  imageQuality: number,
): Promise<void> {
  console.log("Rendering site...");

  const markdownFiles = files.filter((f) => /\.md$/i.test(f.path));
  const imageFiles = files.filter((f) => COMPRESSIBLE_EXT_RE.test(f.path));
  const otherFiles = files.filter((f) => !/\.md$/i.test(f.path) && !COMPRESSIBLE_EXT_RE.test(f.path));

  // Build the render context: page index + image index (both keyed by slug)
  const pageMetas: PageMeta[] = [];
  for (const f of markdownFiles) {
    const title = await pageTitle(f);
    pageMetas.push({ path: f.path, title });
  }

  const pageIndex = new Map(
    pageMetas.map((p) => [slugify(p.path.split("/").pop()!), p]),
  );

  // Compress images and build the image index
  const imageIndex = new Map<string, ImageEntry>();
  for (const f of imageFiles) {
    const compressed = imageQuality > 0
      ? await compressImage(f.absolute, f.path, imageQuality)
      : { body: await readFile(f.absolute), contentType: contentTypeFor(f.path), outputPath: f.path };

    const dest = join(outputDir, compressed.outputPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, compressed.body);

    const entry: ImageEntry = { sourcePath: f.path, outputPath: compressed.outputPath };
    imageIndex.set(slugify(f.path.split("/").pop()!), entry);
  }

  const context: RenderContext = { pages: pageIndex, images: imageIndex };

  // Render every markdown file
  for (const f of markdownFiles) {
    const source = await readFile(f.absolute, "utf8");
    const result = await renderMarkdown(source, context, basenameNoExt(f.path));
    const html = renderLayout({
      title: result.title,
      pagePath: f.path,
      bodyHtml: result.html,
      pages: pageMetas,
      vaultName,
    });
    const outputName = f.path.replace(/\.md$/i, ".html");
    const dest = join(outputDir, outputName);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, html);
  }

  // Copy other (non-image, non-markdown) files through verbatim — PDFs, audio, etc.
  for (const f of otherFiles) {
    const dest = join(outputDir, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(f.absolute));
  }

  // Default styles
  await writeFile(join(outputDir, "styles.css"), DEFAULT_CSS);

  console.log(`  ${markdownFiles.length} pages, ${imageFiles.length} images, ${otherFiles.length} other files`);
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

async function wranglerDeploy(outputDir: string, projectName: string): Promise<void> {
  console.log(`Deploying to Cloudflare Pages project '${projectName}'...`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("npx", ["wrangler", "pages", "deploy", outputDir, `--project-name=${projectName}`], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`wrangler exited ${code}`))));
    proc.on("error", reject);
  });
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
