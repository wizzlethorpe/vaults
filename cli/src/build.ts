import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { availableParallelism } from "node:os";
import picomatch from "picomatch";
import { scanVault, type ScannedFile } from "./scan.js";
import { htmlEscape } from "./escape.js";
import {
  collectDataJsonVaultRefs,
  copyReferencedImages,
  copyReferencedPassthroughs,
} from "./asset-refs.js";
import { downloadFilePaths } from "./render/handlers/builtin/download.js";
import { foundryManifestPaths, manifestDownloadPath } from "./render/handlers/builtin/foundry-manifest.js";
import { buildManifest, type BodyMeta } from "./manifest.js";
import { collectBodyMeta, warnFoundryDocCollisions } from "./foundry-meta.js";
import { compressImage } from "./images.js";
import {
  IMAGE_EXT_RE,
  PASSTHROUGH_EXT_RE,
  COMPRESSIBLE_EXT_RE,
} from "./render/extensions.js";
import { buildFavicon } from "./favicon.js";
import { renderMarkdown, type PreParsedFrontmatter } from "./render/pipeline.js";
import { extractH1 } from "./render/frontmatter.js";
import { renderLayout, render404 } from "./render/layout.js";
import { writeFoundryImporter } from "./foundry-importer.js";
import { slugify } from "./render/slug.js";
import { buildPreview } from "./render/preview.js";
import { resolvePageImage } from "./render/cover.js";
import { DEFAULT_CSS, renderThemeOverride } from "./render/styles.js";
import { loadObsidianSnippets } from "./obsidian.js";
import { loadSettings, writeSettings, SETTINGS_FILE, type Settings } from "./settings.js";
import { loadConfig } from "./config.js";
import { applyFrontmatterDefaults, compileFrontmatterRules } from "./frontmatter-defaults.js";
import matter from "gray-matter";
import { renderAuthMiddleware, renderLoginPage } from "./render/auth-template.js";
import { renderFooterHtml } from "./render/footer.js";
import type { ImageEntry, PageMeta, RenderContext, RenderWarning } from "./render/types.js";
import { buildRegistry, type HandlerRegistry } from "./render/handlers/types.js";
import { loadUserHandlers } from "./render/handlers/loader.js";
import { BUILTIN_HANDLERS } from "./render/handlers/builtin/index.js";
import { bundleHandlerAssets } from "./render/handlers/assets.js";
import { runMigrations } from "./migrate/run.js";
import { cacheDir } from "./paths.js";
import { formatDuration, pMap, Progress } from "./util.js";

export interface BuildOptions {
  vaultPath: string;
  outputDir: string;
  /** Show every page with warnings instead of truncating at 20. */
  allWarnings?: boolean;
}

/** BuildOptions plus the vault properties read out of settings.md. */
type ResolvedOptions = BuildOptions & {
  siteUrl: string;
  vaultName: string;
  imageQuality: number;
  maxFileBytes: number;
};

export interface BuildResult {
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
 * Single-role builds (the default `public`-only case) collapse
 * `_variants/public/...` up to the root.
 */
/**
 * Add basename-slug keys to an asset index, first-write-wins in the vault's
 * sorted path order.
 *
 * Obsidian resolves `![[map.png]]` by basename, so two files with the same
 * name in different folders compete for one key. Writing the key from inside
 * the concurrent staging pass meant whichever finished second won, and that
 * varied between builds on identical input — a page could silently get a
 * different image run to run. Doing it here, sequentially over the sorted
 * list, makes the winner deterministic and lets us say which files collided.
 * (Full-path keys stay in the staging pass; those are unique by definition.)
 */
function addBasenameKeys(
  index: Map<string, ImageEntry>,
  files: ScannedFile[],
  label: string,
): void {
  const claimed = new Map<string, string>(); // slug → winning source path
  for (const f of files) {
    const entry = index.get(f.path);
    if (!entry) continue; // staging failed for this file; nothing to point at
    const slug = slugify(f.path.split("/").pop()!);
    const winner = claimed.get(slug);
    if (winner === undefined) {
      claimed.set(slug, f.path);
      index.set(slug, entry);
      continue;
    }
    console.warn(
      `  ${label} name collision: '${f.path}' and '${winner}' share a filename. `
      + `Bare references like the basename resolve to '${winner}'; `
      + `use the folder path to reach the other.`,
    );
  }
}


/**
 * Emit `sitemap.xml` and `robots.txt` at the deploy root.
 *
 * **Only the default role's pages are listed.** A sitemap naming gated pages
 * would advertise that they exist, and their URLs, to anyone who fetches it —
 * the middleware would still refuse the content, but the leak is the point of
 * a sitemap, so it must never see above the lowest tier.
 *
 * Both files are written only when `site_url` is set, because a sitemap needs
 * absolute URLs and nothing else in the build knows the deploy's public
 * hostname (a Pages project can answer on several).
 */
async function writeSitemap(outputDir: string, siteUrl: string, pagePaths: string[]): Promise<void> {
  const base = siteUrl.replace(/\/+$/, "");
  const urls = pagePaths
    .map((p) => p.replace(/\.md$/i, ""))
    .map((p) => (p === "index" ? "" : p.replace(/\/index$/i, "")))
    .sort()
    .map((p) => `${base}/${p.split("/").map(encodeURIComponent).join("/")}`)
    // index.md becomes the bare base URL rather than "<base>/".
    .map((u) => u.replace(/\/$/, ""));

  const body = [...new Set(urls)]
    .map((u) => `  <url><loc>${htmlEscape(u)}</loc></url>`)
    .join("\n");
  await writeFile(
    join(outputDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
  );
  await writeFile(
    join(outputDir, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`,
  );
}

export async function buildSite(input: BuildOptions): Promise<BuildResult> {
  const start = Date.now();
  const concurrency = Math.max(2, availableParallelism());

  // Run any pending schema / layout migrations before reading anything
  // else. The framework is idempotent: already-migrated vaults pay only
  // the cost of a few stat() calls. See cli/src/migrate/.
  await runMigrations(input.vaultPath);

  // ── Settings (user-editable) ─────────────────────────────────────────────
  const settings = await loadSettings(input.vaultPath);
  for (const w of settings.warnings) console.warn(`  ${w}`);
  if (settings.exists && settings.changed) {
    await writeSettings(input.vaultPath, settings.values);
    console.log(`  rewrote ${SETTINGS_FILE} to canonical format`);
  }
  // settings.md is the single source of truth for vault properties (see the
  // SCHEMA in settings.ts). These used to also be CLI flags, with "was the
  // flag passed?" inferred by comparing against the flag's default — and the
  // defaults matched the schema's, so `build -q 85` against an
  // `image_quality: 40` vault silently produced 40. The flags are gone; the
  // vault decides.
  let opts: ResolvedOptions = {
    ...input,
    siteUrl: settings.values.site_url,
    vaultName: settings.values.vault_name,
    imageQuality: settings.values.image_quality,
    maxFileBytes: settings.values.max_file_bytes,
  };

  // ── Custom handlers ──────────────────────────────────────────────────────
  // Built-ins ship with the CLI; user handlers live in `.vaults/handlers/`
  // and can override built-in names (last-registered wins). One registry
  // is built once and shared across every variant render.
  const userHandlers = await loadUserHandlers(opts.vaultPath);
  const handlerRegistry: HandlerRegistry = buildRegistry(
    BUILTIN_HANDLERS,
    userHandlers.map((h) => h.handler),
  );
  if (userHandlers.length > 0) {
    console.log(`  loaded ${userHandlers.length} custom handler(s) from .vaults/handlers/`);
  }
  // Concatenate browser-side assets declared by built-in and user handlers
  // into a single _handlers.js / _handlers.css emitted at the deploy root.
  // Each unique source is included once, regardless of invocation count.
  // Two independent flags so a deploy with only-JS or only-CSS doesn't
  // reference a file that wasn't written.
  const handlerAssets = await bundleHandlerAssets(userHandlers, BUILTIN_HANDLERS, opts.vaultPath);
  const hasHandlerJs = handlerAssets.js.length > 0;
  const hasHandlerCss = handlerAssets.css.length > 0;

  // Footer markdown rendered once per build; the resulting HTML is
  // embedded verbatim in every page's layout. Empty string = no footer.
  const footerHtml = await renderFooterHtml(settings.values.footer);

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
  // `dot: true` because these are *exclusions*. A wildcard that refuses to cross
  // a leading dot means `tools/**` silently spares `tools/.venv/**` and
  // `tools/.ruff_cache/**` — the parts an ignore rule most wants gone. Nobody
  // writes one hoping it will keep the hidden files.
  const ignoreMatchers = settings.values.ignore.map((p) => picomatch(p, { dot: true }));
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

  // Atomic build: write into <outputDir>.tmp and rename at the end.
  // A failed mid-build leaves the previous deploy intact instead of
  // serving half a website. Re-point opts.outputDir at the work dir so
  // every downstream writeFile / mkdir lands in the right place.
  const finalOutputDir = opts.outputDir;
  const workOutputDir = finalOutputDir + ".tmp";
  await rm(workOutputDir, { recursive: true, force: true });
  await mkdir(workOutputDir, { recursive: true });
  opts = { ...opts, outputDir: workOutputDir };

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
  // Read the ```download blocks first: a file named by one is shipped whatever
  // its extension, so it must not also be reported as skipped. Warning about a
  // file that then gets staged sends the reader off to set
  // include_unknown_files for no reason.
  const downloadPaths = new Set<string>();
  const manifestPaths = new Set<string>();
  const manifestDownloads = new Map<string, string>();
  for (const f of markdownFiles) {
    const source = await readFile(f.absolute, "utf8");
    for (const path of downloadFilePaths(source)) downloadPaths.add(path);
    for (const path of foundryManifestPaths(source)) manifestPaths.add(path);
  }
  // A foundry-manifest block names only the manifest. The zip is whatever the
  // manifest's own download field says, so read it and ship that too — the
  // author should not have to repeat a path the manifest already states, and
  // an install needs both halves present or it fails on the second fetch.
  for (const rel of manifestPaths) {
    downloadPaths.add(rel);
    const file = withinLimit.find((f) => f.path === rel);
    if (!file) continue;
    const { path, absolute } = manifestDownloadPath(await readFile(file.absolute, "utf8"));
    if (absolute) {
      console.warn(
        `  ${rel}: "download" is an absolute URL (${absolute}). Make it relative`
        + ` (e.g. "/downloads/module.zip") so it resolves on whichever host serves this`
        + ` vault — an absolute one cannot be signed for a gated install, and the`
        + ` install fails fetching the file.`,
      );
    }
    if (path) {
      downloadPaths.add(path);
      manifestDownloads.set(rel, path);
    }
  }
  const unknownFiles = withinLimit.filter((f) =>
    !/\.md$|\.base$/i.test(f.path)
    && !IMAGE_EXT_RE.test(f.path)
    && !PASSTHROUGH_EXT_RE.test(f.path)
    && !downloadPaths.has(f.path),
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
    : [...passthroughFiles];

  // Files named by a ```download block join the pool whatever their
  // extension. A download is usually a .zip or a module.json, which the
  // passthrough list calls unknown and drops — but naming one in a block is
  // the author asking for it by name, which is exactly the intent
  // include_unknown_files exists to require. Role gating is untouched: these
  // are still reference-gated, so a download on a patron page reaches the
  // patron variant and no other.
  if (downloadPaths.size > 0) {
    const already = new Set(stagedPassthroughs.map((f) => f.path));
    const promoted = withinLimit.filter((f) => downloadPaths.has(f.path) && !already.has(f.path));
    const missing = [...downloadPaths].filter((p) => !withinLimit.some((f) => f.path === p));
    for (const p of missing) {
      console.warn(`  download block names '${p}', which is not in the vault; the link will 404.`);
    }
    if (promoted.length > 0) {
      console.log(`  staging ${promoted.length} file(s) named by download / foundry-manifest blocks`);
      stagedPassthroughs.push(...promoted);
    }
  }

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

  // One parse per page: gray-matter is the single source of truth for every
  // frontmatter field, including `role` (which gates access). Sources are
  // normalized for Obsidian quirks first; malformed YAML throws inside
  // parsePageFrontmatter and aborts the build rather than silently dropping a
  // page's metadata (and, with it, its role gate).
  const frontmatterRules = compileFrontmatterRules(settings.values.default_frontmatter);
  const parsedSources = new Map<string, PreParsedFrontmatter>();
  for (const f of markdownFiles) {
    const parsed = parsePageFrontmatter(sources.get(f.path)!, f.path);
    // Applied here, at the one place a page's frontmatter is read, so that
    // roles, the rendered wiki, the manifest the Foundry client syncs from and
    // the module compiler all see the same page. A default that only some of
    // them honoured would be a way for a synced vault and an installed module
    // to disagree about the same file.
    applyFrontmatterDefaults(f.path, parsed.data, frontmatterRules);
    parsedSources.set(f.path, parsed);
  }

  // Derive role/title/aliases per page from that parse. A role that's present
  // but isn't a configured role fails the build (collected below): falling back
  // to a lower tier would silently expose pages the author meant to gate. The
  // full frontmatter is stashed on each PageMeta so the Bases plugin can query
  // arbitrary properties.
  const roleErrors: string[] = [];
  const allPageMetas: PageMeta[] = markdownFiles.map((f) => {
    const src = sources.get(f.path)!;
    const fm = parsedSources.get(f.path)!.data;

    const role = fm.role == null ? defaultRole : String(fm.role);
    if (!allRoleSet.has(role)) {
      roleErrors.push(`  ${f.path}: role "${role}" is not one of settings.roles [${roles.join(", ")}]`);
    }
    const title = (typeof fm.title === "string" ? fm.title
      : fm.title != null ? String(fm.title) : undefined)
      ?? extractH1(src) ?? basenameNoExt(f.path);
    const aliases = toStringArray(fm.aliases);

    return {
      path: f.path,
      title,
      role,
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(Object.keys(fm).length > 0 ? { frontmatter: fm } : {}),
      mtime: f.mtime,
      birthtime: f.birthtime,
    };
  });
  if (roleErrors.length > 0) {
    throw new Error(
      `Unknown frontmatter role on ${roleErrors.length} page(s) (build aborted so gated pages can't leak):\n${roleErrors.join("\n")}`,
    );
  }

  // Stage assets referenced inside each page's foundry.data_json (Scene
  // backgrounds / ambient sounds / tile art live in that JSON, not the page
  // frontmatter, so the asset scanners below consult p.foundryAssets).
  await Promise.all(allPageMetas.map(async (p) => {
    if (!p.frontmatter) return;
    const refs = await collectDataJsonVaultRefs(opts.vaultPath, p.frontmatter, p.path);
    if (refs.length > 0) p.foundryAssets = refs;
  }));

  // ── Image compression (staged; copied per-variant later) ────────────────
  // Compress once into a private staging dir under the deploy root. Each
  // variant's render pass copies whichever images its visible pages
  // reference. The staging dir is removed at the end so images only ship
  // to the variants that need them; that's how DM-only art is kept off
  // the public deploy without a separate auth gate.
  const imageStagingDir = join(opts.outputDir, ".image-staging");
  const imageIndex = new Map<string, ImageEntry>();
  if (imageFiles.length > 0) {
    const cacheImageDir = join(cacheDir(opts.vaultPath), "images", `q${opts.imageQuality}`);
    await mkdir(cacheImageDir, { recursive: true });
    let cacheHits = 0;
    const progress = new Progress("Images");
    progress.update(0, imageFiles.length);

    await pMap(imageFiles, concurrency, async (f) => {
      // SVGs / non-compressible images pass through; everything else gets
      // recoded to webp for size. Either way they land in the staging dir.
      const compressed = opts.imageQuality > 0 && COMPRESSIBLE_EXT_RE.test(f.path)
        ? await compressImageCached(f, opts.imageQuality, cacheImageDir, () => { cacheHits++; })
        : { body: await readFile(f.absolute), outputPath: f.path };

      const dest = join(imageStagingDir, compressed.outputPath);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, compressed.body);

      // Two keys for one entry: basename slug for body wikilinks/embeds
      // (Obsidian resolves those by basename), and the full vault-relative
      // path for `@vault/PATH` refs (frontmatter, data_json). Paths contain
      // "/" and slugs don't, so the keyspaces never overlap. The full-path
      // key is what stops identically-named assets in different scene folders
      // (e.g. a shared `Water Fountain (Loop).ogg`) from colliding under one
      // basename slug and staging only one of them.
      // Full-path key only; basename keys are added afterwards, in sorted
      // order, so a duplicated filename resolves deterministically.
      imageIndex.set(f.path, { sourcePath: f.path, outputPath: compressed.outputPath });
    }, (done, total) => progress.update(done, total));

    progress.done(`${imageFiles.length} processed (${cacheHits} cached, ${imageFiles.length - cacheHits} compressed)`);
  }
  addBasenameKeys(imageIndex, imageFiles, "image");

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
      // Dual-keyed like imageIndex: basename slug for body refs, full
      // vault-relative path for `@vault/PATH` refs (ambient sounds in
      // data_json), so same-named files in different folders don't collide.
      passthroughIndex.set(f.path, { sourcePath: f.path, outputPath: f.path });
    }, (done, total) => progress.update(done, total));
    progress.done(`${stagedPassthroughs.length} staged`);
  }
  addBasenameKeys(passthroughIndex, stagedPassthroughs, "passthrough");

  // Shared CSS bundle.
  //
  // Every file written to outputDir ROOT (rather than into _variants/<role>/)
  // must also appear in `isSharedAsset` over in render/auth-template.ts —
  // otherwise the variant rewrite traps it and it 404s for everyone. If you
  // add a new root-level file here, add it there too.
  const themeOverride = renderThemeOverride({
    lightAccent: settings.values.accent_color,
    lightBg: settings.values.bg_color,
    darkAccent: settings.values.accent_color_dark,
    darkBg: settings.values.bg_color_dark,
  });
  await writeFile(join(opts.outputDir, "styles.css"), DEFAULT_CSS + themeOverride);
  const userCss = await loadObsidianSnippets(opts.vaultPath);
  await writeFile(join(opts.outputDir, "user.css"), userCss);
  if (userCss) console.log(`  loaded user.css from .obsidian/snippets/`);

  // Browser-side handler assets (built-in + user) concatenated into a
  // single deploy-root JS and CSS file. Skipped entirely if no handler
  // declared any assets (purely declarative handlers stay overhead-free).
  if (hasHandlerJs) await writeFile(join(opts.outputDir, "_handlers.js"), handlerAssets.js);
  if (hasHandlerCss) await writeFile(join(opts.outputDir, "_handlers.css"), handlerAssets.css);

  // Cache-busting token for the shared root assets (styles.css, user.css,
  // _handlers.*). Browsers cache these heuristically and serve stale copies
  // after a push until a hard refresh; stamping a content hash onto their
  // URLs makes a changed asset a new URL, so it's re-fetched automatically.
  // One combined hash keeps it simple; any shared-asset change busts all.
  // katex version rides in the hash so a dependency upgrade re-fetches the
  // (otherwise never-changing) /katex/katex.min.css on math pages.
  const katexVersion = katexRequire()("katex/package.json").version as string;
  const assetVersion = createHash("md5")
    .update(DEFAULT_CSS + themeOverride + userCss + handlerAssets.js + handlerAssets.css + katexVersion)
    .digest("hex")
    .slice(0, 10);

  // Foundry importer bundle: one ESM file the Foundry module fetches at
  // sync time. Skipped entirely when the vault has opted out of the Foundry
  // integration — it is ~60KB shipped to every deploy, and a course site or
  // research wiki will never fetch it.
  const foundryEnabled = settings.values.foundry;
  if (foundryEnabled) await writeFoundryImporter(opts.outputDir);
  // Foundry-import bundles are written per-variant inside the role loop
  // below (instead of at the root) so the middleware role-gates them. A
  // public visitor can't fetch the dm-tier handler bundle even if it
  // contains different content. The path stays `/_handlers.foundry.{js,css}`
  // — the middleware rewrites root requests to the matching variant.

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
  //
  // Pre-strip every role-typed callout from the body before discovery: the
  // cover URL has to be the same across all variants the page is visible
  // in, so it must not come from inside a `[!dm]` block (which would leak
  // the image to public deploys). Frontmatter `image:` values are honoured
  // as-is — those are explicit author intent.
  // Callout types are matched case-insensitively (both stripRoleGatedCallouts
  // and the renderer's calloutPlugin lowercase the `[!type]`), so these
  // redaction sets must be lowercased too — otherwise a role like "Previewer"
  // never matches its `[!Previewer]` callouts and the block leaks to lower
  // tiers. Page-level role gating (visibleRoles) stays exact-case.
  const allRoleTypes = new Set(roles.map((r) => r.toLowerCase()));
  for (const meta of allPageMetas) {
    const src = sources.get(meta.path);
    if (!src) continue;
    const stripped = stripRoleGatedCallouts(src, allRoleTypes);
    const cover = resolvePageImage(stripped, meta.frontmatter, imageIndex, settings.values.auto_image);
    if (cover) meta.coverImage = cover;
  }

  warnFoundryDocCollisions(allPageMetas);

  // ── Per-role variant builds ─────────────────────────────────────────────
  const perRolePageCount: Record<string, number> = {};
  const collapseToRoot = roles.length === 1;
  let defaultRolePagePaths: string[] = [];
  let katexCopied = false;

  for (const role of roles) {
    const variantDir = collapseToRoot
      ? opts.outputDir
      : join(opts.outputDir, "_variants", role);
    if (!collapseToRoot) await mkdir(variantDir, { recursive: true });

    // Roles up to and including this one are visible. Anything higher is
    // redacted (callouts dropped, pages skipped, wikilinks broken).
    const idx = roles.indexOf(role);
    const visibleRoles = new Set(roles.slice(0, idx + 1));
    // Lowercased: redactRoles gates callouts by `[!type]`, which is matched
    // case-insensitively (see allRoleTypes above).
    const redactRoles = new Set(roles.slice(idx + 1).map((r) => r.toLowerCase()));

    const stats = await buildVariant({
      role,
      visibleRoles,
      redactRoles,
      variantDir,
      vaultName: opts.vaultName,
      vaultPath: opts.vaultPath,
      allPageMetas,
      sources,
      parsedSources,
      baseSources,
      imageIndex,
      manifestDownloads,
      imageStagingDir,
      passthroughIndex,
      passthroughStagingDir: otherStagingDir,
      settings: settings.values,
      authConfigured: roles.length > 1,
      handlerRegistry,
      hasHandlerJs,
      hasHandlerCss,
      assetVersion,
      footerHtml,
      concurrency,
      allWarnings: opts.allWarnings,
    });
    perRolePageCount[role] = stats.pageCount;
    // Only the default (lowest) role feeds the sitemap; see writeSitemap.
    if (role === roles[0]) defaultRolePagePaths = stats.pagePaths;
    if (!collapseToRoot) console.log(`  variant '${role}': ${stats.pageCount} pages`);

    // KaTeX stylesheet + fonts, shared at the deploy root. Copied lazily on
    // the first variant that rendered math (before that variant's manifest is
    // built, so the manifest sees them); math-free vaults ship nothing.
    if (stats.hasMath && !katexCopied) {
      await copyKatexAssets(join(opts.outputDir, "katex"));
      katexCopied = true;
    }

    // Foundry-import opt-in bundles, emitted INSIDE the variant directory
    // (not at the deploy root) so the auth middleware role-gates them.
    // Single-role builds collapse variantDir to outputDir, so the file
    // ends up at root automatically. The Foundry module fetches by the
    // canonical `/_handlers.foundry.{js,css}` path; the middleware
    // rewrites that to the matching `_variants/<role>/...` per the
    // requesting bearer token's role.
    // Foundry-import subset bundles. The Foundry module fetches these by
    // their canonical `/_handlers.foundry.{js,css}` paths; the middleware
    // role-gates per the requesting bearer's variant.
    if (foundryEnabled && handlerAssets.foundry) {
      if (handlerAssets.foundry.js.length > 0) {
        await writeFile(join(variantDir, "_handlers.foundry.js"), handlerAssets.foundry.js);
      }
      if (handlerAssets.foundry.css.length > 0) {
        await writeFile(join(variantDir, "_handlers.foundry.css"), handlerAssets.foundry.css);
      }
    }

    // Write a per-variant _manifest.json so external clients (Foundry, MCP,
    // etc.) can do an incremental diff. Includes EVERY file that variant
    // serves; html, md, images (as relative paths into shared root), css.
    // bodyMeta carries per-page Foundry reskin metadata; folded into each
    // body row's hash so meta-only changes trigger a re-sync.
    const manifest = await buildManifest(
      opts.outputDir, variantDir, stats.bodyMeta, !collapseToRoot, roles, opts.vaultName,
      {
        hasHandlerJs,
        hasHandlerCss,
        hasFoundryJs: foundryEnabled && (handlerAssets.foundry?.js.length ?? 0) > 0,
        hasFoundryCss: foundryEnabled && (handlerAssets.foundry?.css.length ?? 0) > 0,
      },
    );
    await writeFile(join(variantDir, "_manifest.json"), JSON.stringify(manifest));
  }

  // ── Pages Functions ─────────────────────────────────────────────────────
  // Auth middleware ships only for multi-role builds. Single-role deploys
  // are pure static and need no functions.
  if (!collapseToRoot) {
    const fnDir = join(opts.outputDir, "functions");
    await mkdir(fnDir, { recursive: true });
    // Patreon overlay rides only when configured AND at least one role is
    // mapped to a tier. clientSecret stays out of the bundle — it lives in
    // the Wrangler secret PATREON_CLIENT_SECRET, read from env in the
    // Function. The CLI uploads it on every push.
    const patreon = cfg.oauth?.patreon;
    const patreonForFn = patreon && patreon.tiers && Object.keys(patreon.tiers).length > 0
      ? {
          clientId: patreon.clientId,
          campaignId: patreon.campaignId,
          tiers: patreon.tiers,
        }
      : null;
    // Same contract for the OIDC overlay: rides only when configured AND at
    // least one role has a rule; clientSecret stays in the Wrangler secret
    // OAUTH_CLIENT_SECRET, read from env in the Function.
    const oidc = cfg.oauth?.oidc;
    const oidcForFn = oidc && oidc.roleRules && Object.keys(oidc.roleRules).length > 0
      ? {
          displayName: oidc.displayName,
          clientId: oidc.clientId,
          authorizationEndpoint: oidc.authorizationEndpoint,
          tokenEndpoint: oidc.tokenEndpoint,
          userinfoEndpoint: oidc.userinfoEndpoint,
          roleRules: oidc.roleRules,
        }
      : null;
    const middleware = renderAuthMiddleware({
      roles,
      foundry: foundryEnabled,
      rolePasswords: cfg.rolePasswords,
      ...(patreonForFn ? { patreon: patreonForFn } : {}),
      ...(oidcForFn ? { oidc: oidcForFn } : {}),
    });
    await writeFile(join(fnDir, "_middleware.js"), middleware);

    // Login page, showing only the methods this deploy actually has. A role
    // is reachable by password only if a hash was set for it, so a vault
    // authenticating purely through Patreon or OIDC gets no password form
    // and no role selector.
    const protectedRoles = roles.slice(1);
    const passwordRoles = protectedRoles.filter((r) => cfg.rolePasswords[r]);
    const patreonRoles = patreonForFn ? Object.keys(patreonForFn.tiers) : [];
    const oidcRoles = oidcForFn ? Object.keys(oidcForFn.roleRules ?? {}) : [];
    await writeFile(join(opts.outputDir, "login.html"), renderLoginPage({
      passwordRoles,
      patreonRoles,
      oidcDisplayName: oidcForFn ? oidcForFn.displayName : null,
    }));

    // The error is a role nobody can reach, not a role without a password —
    // password-less is the point when a provider grants the role instead.
    const unreachable = protectedRoles.filter(
      (r) => !cfg.rolePasswords[r] && !patreonRoles.includes(r) && !oidcRoles.includes(r),
    );
    if (unreachable.length > 0) {
      console.warn(
        `  WARNING: no way to sign in as role(s): ${unreachable.join(", ")}. `
        + `Set a password ('vaults password <role>'), map a Patreon tier `
        + `('vaults patreon link <role> <tier-id>'), or add an OIDC rule `
        + `('vaults oidc configure'). Pages at these roles will be unreachable.`,
      );
    }
  }

  // Search-engine files. Written from the default role's page list only, so a
  // gated page is never named. Skipped entirely without a site_url.
  if (opts.siteUrl) {
    await writeSitemap(opts.outputDir, opts.siteUrl, defaultRolePagePaths);
  }

  // Drop the staging dirs; their contents have been copied into each
  // variant that needs them, so they're no longer required for the deploy.
  await rm(imageStagingDir, { recursive: true, force: true });
  await rm(otherStagingDir, { recursive: true, force: true });

  // Atomic swap: move the freshly-built tree into the final location.
  // rm-then-rename: Node's rename refuses to overwrite a non-empty dir.
  // A crash between rm and rename leaves the output missing, which is
  // visibly broken rather than silently half-built.
  await rm(finalOutputDir, { recursive: true, force: true });
  await rename(workOutputDir, finalOutputDir);

  console.log(`Built in ${formatDuration(Date.now() - start)}.`);
  return {
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
  /** Vault root, used to resolve `foundry.data_json` paths declared in page frontmatter. */
  vaultPath: string;
  allPageMetas: PageMeta[];
  sources: Map<string, string>;
  /** Per-page pre-parsed gray-matter result, threaded through to renderMarkdown. */
  parsedSources: Map<string, PreParsedFrontmatter>;
  /** slugified basename → raw YAML for standalone `.base` files. */
  baseSources: Map<string, string>;
  imageIndex: Map<string, ImageEntry>;
  /** Manifest path -> the file its own download field names; see copyReferencedPassthroughs. */
  manifestDownloads: ReadonlyMap<string, string>;
  /** Staging dir holding compressed images; we copy what's referenced. */
  imageStagingDir: string;
  /** Passthrough media (audio/video/pdf/epub) staged once, reference-copied per variant. */
  passthroughIndex: Map<string, ImageEntry>;
  passthroughStagingDir: string;
  settings: Settings;
  /** Whether the deployment has more than one role (controls auth-box rendering). */
  authConfigured: boolean;
  /** Built-in + user-defined handler registry, shared across variants. */
  handlerRegistry: HandlerRegistry;
  /** Set when /_handlers.js will be emitted at the deploy root. */
  hasHandlerJs: boolean;
  /** Set when /_handlers.css will be emitted at the deploy root. */
  hasHandlerCss: boolean;
  /** Content-hash query token appended to shared asset URLs for cache busting. */
  assetVersion: string;
  /** Pre-rendered footer HTML (empty string = footer hidden). */
  footerHtml: string;
  concurrency: number;
  allWarnings: boolean | undefined;
}

interface VariantStats {
  pageCount: number;
  /** Vault-relative .md paths visible in this variant, for the sitemap. */
  pagePaths: string[];
  /** Maps `.body.html` path (variant-relative) to its meta payload. Empty unless any page sets a foundry block / image. */
  bodyMeta: Map<string, BodyMeta>;
  /** True when any page in this variant rendered KaTeX math. */
  hasMath: boolean;
}

async function buildVariant(a: VariantArgs): Promise<VariantStats> {
  // Pages this variant can see (page.role is in visibleRoles).
  const visibleSources = new Map<string, string>();
  const visibleMetas: PageMeta[] = [];
  for (const m of a.allPageMetas) {
    if (!a.visibleRoles.has(m.role)) continue;
    visibleMetas.push(m);
    // Strip role-gated callouts from the source BEFORE it enters any
    // downstream pass (renderer, transclusion, asset scanner, outlinks).
    // The renderer's calloutPlugin redacts at render time, but the source
    // is what the asset scanner walks — without this strip, an
    // `![[secret.webp]]` inside a `[!dm]` callout on a `role: public`
    // page would copy the file into the public deploy and be reachable
    // by URL even though the article hides the callout.
    const raw = a.sources.get(m.path)!;
    visibleSources.set(m.path, stripRoleGatedCallouts(raw, a.redactRoles));
  }

  // Synthesize folder indexes from the visible set only.
  const folderIndexes = generateFolderIndexes(visibleMetas, a.role, a.settings.inline_title);
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

  // Pre-compute outlinks per page so the Bases plugin can answer
  // file.hasLink() during render (Bases runs before the wikilink plugin
  // populates the per-render outlinks list).
  const outlinksByPath = collectOutlinksByPath(visibleMetas, visibleSources, pageIndex);

  const context: RenderContext = {
    pages: pageIndex,
    images: a.imageIndex,
    passthroughs: a.passthroughIndex,
    markdownContent,
    bases: a.baseSources,
    defaultImageWidth: a.settings.default_image_width,
    redactRoles: a.redactRoles,
    handlers: a.handlerRegistry,
    outlinksByPath,
  };

  // Pass 1: render bodies + collect outlinks + warnings.
  interface Rendered { title: string; html: string; outlinks: string[]; warnings: RenderWarning[]; hasMath: boolean; }
  const rendered = new Map<string, Rendered>();

  const progress = new Progress(`Pages (${a.role})`);
  progress.update(0, visibleMetas.length);
  await pMap(visibleMetas, a.concurrency, async (p) => {
    const result = await renderMarkdown(
      visibleSources.get(p.path)!,
      context,
      basenameNoExt(p.path),
      a.parsedSources.get(p.path),
    );
    rendered.set(p.path, {
      title: result.title,
      html: result.html,
      outlinks: result.outlinks,
      warnings: result.warnings,
      hasMath: result.hasMath,
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
  // Math CSS is variant-wide, not per-page: hover previews inject other
  // pages' rendered HTML, so a math-free page can still display math.
  const hasMathCss = [...rendered.values()].some((r) => r.hasMath);
  const previewMode = previewModeOf(a.settings.preview_mode);
  const previewModeMobile = previewModeOf(a.settings.preview_mode_mobile);
  const previewsEnabled = previewMode !== "none" || previewModeMobile !== "none";
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
      previewMode,
      previewModeMobile,
      backlinks,
      authConfigured: a.authConfigured,
      hasHandlerJs: a.hasHandlerJs,
      hasHandlerCss: a.hasHandlerCss,
      hasMathCss,
      assetVersion: a.assetVersion,
      footerHtml: a.footerHtml,
      theme: themeOf(a.settings.theme),
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

    bodyMeta.set(bodyPath, await collectBodyMeta(p, a.vaultPath));

    // Preview JSON feeds the popover; skip it only when neither device class
    // shows previews (both modes "none").
    if (previewsEnabled) {
      const source = visibleSources.get(p.path)!;
      const preview = await buildPreview(source, r.title, {
        frontmatter: a.parsedSources.get(p.path)?.data ?? {},
        registry: a.handlerRegistry,
        renderContext: context,
        pagePath: p.path,
      });
      await writeFile(join(a.variantDir, outputBase + ".preview.json"), JSON.stringify(preview));
    }
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
    previewMode,
    previewModeMobile,
    authConfigured: a.authConfigured,
    hasHandlerJs: a.hasHandlerJs,
    hasHandlerCss: a.hasHandlerCss,
    hasMathCss,
    assetVersion: a.assetVersion,
    footerHtml: a.footerHtml,
    theme: themeOf(a.settings.theme),
  }));

  // Per-variant search index. `text` is the page's RENDERED HTML body
  // collapsed to plain text (tags stripped, entities decoded), so search
  // snippets read the same way the page reads — no leftover markdown
  // syntax (`|`, `**`, raw HTML) bleeding into the dropdown.
  const searchIndex = visibleMetas.map((p) => ({
    title: p.title,
    path: p.path,
    href: "/" + p.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/"),
    folder: p.path.includes("/") ? p.path.split("/").slice(0, -1).join("/") : "",
    text: htmlToText(rendered.get(p.path)?.html ?? "", 1500),
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
  await copyReferencedPassthroughs(visibleSources, visibleMetas, a.passthroughIndex, a.passthroughStagingDir, a.variantDir, a.manifestDownloads);

  return {
    pageCount: visibleMetas.length,
    pagePaths: visibleMetas.map((m) => m.path),
    bodyMeta,
    hasMath: hasMathCss,
  };
}

/**
 * Resolve the katex package that *rehype-katex* renders with, which is not
 * necessarily this package's own katex dependency: under pnpm's isolated
 * node_modules, rehype-katex gets the copy matching its own range. The
 * stylesheet has to come from that copy, because KaTeX renames its CSS
 * classes between versions ('sizing' became 'katex-sizing' in 0.18), and a
 * stylesheet from a different version silently stops matching the markup:
 * subscripts render at full size instead of 0.7em.
 */
function katexRequire(): NodeRequire {
  const here = createRequire(import.meta.url);
  return createRequire(here.resolve("rehype-katex"));
}

/**
 * Copy KaTeX's stylesheet and fonts (from the katex rehype-katex uses) to
 * <outputDir>/katex/. woff2 only: the CSS lists woff2 first, so any browser
 * that supports it (all modern ones) never requests the woff/ttf fallbacks.
 */
async function copyKatexAssets(destDir: string): Promise<void> {
  const distDir = join(
    dirname(katexRequire().resolve("katex/package.json")),
    "dist",
  );
  await mkdir(join(destDir, "fonts"), { recursive: true });
  await copyFile(join(distDir, "katex.min.css"), join(destDir, "katex.min.css"));
  for (const f of await readdir(join(distDir, "fonts"))) {
    if (f.endsWith(".woff2")) {
      await copyFile(join(distDir, "fonts", f), join(destDir, "fonts", f));
    }
  }
}

/**
 * Build the per-body manifest meta from a page's frontmatter + resolved
 * cover image. `role` always lands so the Foundry side can apply the
 * dmRole permission gate; the foundry / image fields are conditional.
 *
 * Frontmatter shape forwarded to clients:
 *   foundry:
 *     base: <UUID> | <Type>[:<subtype>]   # required for instantiation
 *     sync: false                           # default true; skip Foundry entirely
 *     journal: false                        # default true; doc only, no journal page
 *     link: doc                             # default journal; link to the doc instead
 *     embed: false                          # default true
 *     data: { … deep-merged into the doc }
 */

/** Coerce settings.theme to the layout's narrowed union, defaulting to
 *  "auto" for any unrecognised value rather than failing the build. */
function themeOf(s: string): "auto" | "light" | "dark" {
  return s === "light" || s === "dark" ? s : "auto";
}

function previewModeOf(s: string): "none" | "normal" | "sticky" {
  return s === "none" || s === "sticky" ? s : "normal";
}






// `> [!type]…` opens a callout; the rest of the contiguous blockquote (lines
// starting with `>`, blank line ends) is its body. Used to strip role-gated
// callouts from the source before any downstream pass sees it.
const CALLOUT_HEAD_RE = /^>\s*\[!(\w+)\]/;

/**
 * Drop callout blocks whose type is in `redactRoles` from the source. Walks
 * line-by-line; on a callout-head line whose type is redacted, drops every
 * subsequent line that is part of the same blockquote (starts with `>`).
 * A blank line ends the blockquote per CommonMark.
 *
 * Approximate by markdown standards (doesn't handle lazy-continuation lines
 * or nested blockquotes containing role-gated children), but covers every
 * pattern the asset scanner needs to gate against. The renderer's
 * calloutPlugin still runs as the source of truth for visual redaction;
 * this strip is the asset-leak guard.
 */
function stripRoleGatedCallouts(source: string, redactRoles: ReadonlySet<string>): string {
  if (redactRoles.size === 0) return source;
  const lines = source.split("\n");
  const out: string[] = [];
  let dropping = false;
  for (const line of lines) {
    if (dropping) {
      if (line.startsWith(">")) continue;            // still inside the blockquote
      dropping = false;
      out.push(line);                                // blank or non-`>` line ends + keeps the line
      continue;
    }
    const head = CALLOUT_HEAD_RE.exec(line);
    if (head && redactRoles.has(head[1]!.toLowerCase())) {
      dropping = true;
      continue;                                      // drop the head line
    }
    out.push(line);
  }
  return out.join("\n");
}




interface FolderIndex {
  path: string;
  title: string;
  markdown: string;
}

/**
 * Build synthesised index.md for any folder (including the root) that has
 * pages but no existing index.md. When `inlineTitle` is true, the layout
 * already injects an <h1> from the page's title, so the synthesised body
 * skips its own `# Title` heading to avoid the duplicate.
 */
function generateFolderIndexes(
  existing: PageMeta[],
  _role: string,
  inlineTitle: boolean,
): FolderIndex[] {
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
      // with quotes/special chars survives inside the filter expression,
      // then YAML-single-quote the whole expression so a folder name with
      // an apostrophe (e.g. "Seylon's Secrets") doesn't terminate the
      // scalar and break `yaml.load`.
      const folderExpr = yamlSingleQuote(`file.folder == ${JSON.stringify(folder)}`);
      const filtersBlock = `filters:\n  and:\n    - ${folderExpr}\n    - 'file.name != "index"'`;
      const propsBlock = propsYaml ? `properties:\n${propsYaml}\n` : "";
      sections.push(`## Pages\n\n\`\`\`base\n${filtersBlock}\n${propsBlock}views:\n  - type: table\n    name: Contents\n    order:\n${orderYaml}\n\`\`\``);
    }

    // With inline_title on, the layout injects an <h1> from the page's
    // title — which it learns from the markdown's title source. We can
    // either author the title as a `# Heading` (off-mode) or as YAML
    // frontmatter (on-mode); the latter avoids the duplicated <h1> while
    // still letting the renderer surface the right title.
    const displayTitle = title || "Home";
    const heading = inlineTitle ? "" : (title ? `# ${title}\n\n` : "");
    const frontmatter = inlineTitle ? `---\ntitle: ${yamlString(displayTitle)}\n---\n\n` : "";
    out.push({
      path: indexPath,
      title: displayTitle,
      markdown: `${frontmatter}${heading}${sections.join("\n\n")}\n`,
    });
  }
  return out;
}

/** Wrap a string as a YAML single-quoted scalar, doubling any literal quote. */
function yamlSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** YAML-quote a string only when needed (special chars or ambiguous flow). */
function yamlString(s: string): string {
  if (/^[A-Za-z0-9_ .-]+$/.test(s) && !/^(true|false|null|yes|no)$/i.test(s)) return s;
  return JSON.stringify(s);
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
      if (v == null || v === "") continue;
      // Skip non-scalar values — arrays and plain objects render as
      // "[object Object]" or comma-joined junk in a table cell. Dates
      // are technically objects but renderValue formats them nicely,
      // so let them through.
      if (typeof v === "object" && !(v instanceof Date)) continue;
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

/**
 * Pull the raw `---\n...\n---` frontmatter block out of a markdown source so
 * the layout can show it verbatim (preserving the user's exact formatting,
 * comments, and key order). Returns the inner-block text or null when the
 * page has no frontmatter. The shape `{ frontmatterYaml }` is so callers can
 * spread it directly into the LayoutInput; missing frontmatter contributes
 * nothing to the layout.
 */
// Pre-compute outgoing wikilinks per page (vault path → set of vault paths).
// Bases needs this before render runs so file.hasLink() can answer truthfully
// during render; the wikilink plugin's per-render outlinks list is collected
// after Bases has already drawn the table. A regex scan over markdown source
// (rather than rebuilding the AST) is fine: this only needs to detect link
// targets, and an embedded ![[image.png]] resolves to no page anyway.
const WIKILINK_SCAN_RE = /(?<!!)(?<!\[)\[\[([^\[\]|#\n]+?)(?:#[^\[\]|\n]+?)?(?:\|[^\[\]#\n]+?)?\]\]/g;
function collectOutlinksByPath(
  metas: PageMeta[],
  sources: Map<string, string>,
  pageIndex: Map<string, PageMeta>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const p of metas) {
    const src = sources.get(p.path);
    if (!src) continue;
    const targets = new Set<string>();
    for (const match of src.matchAll(WIKILINK_SCAN_RE)) {
      const name = match[1]!.trim();
      const slug = slugify(name);
      const last = name.includes("/") ? name.split("/").pop()! : "";
      const page = pageIndex.get(slug)
        ?? pageIndex.get(slugify(name + "/index"))
        ?? (last ? pageIndex.get(slugify(last)) : undefined);
      if (page && page.path !== p.path) targets.add(page.path);
    }
    if (targets.size > 0) out.set(p.path, targets);
  }
  return out;
}

function extractFrontmatterBlock(source: string): { frontmatterYaml: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!m || !m[1] || !m[1].trim()) return null;
  return { frontmatterYaml: m[1] };
}

/**
 * Normalize an Obsidian-flavored frontmatter block into strict YAML before
 * gray-matter sees it. This is the one place to absorb editor/Obsidian quirks
 * that aren't valid YAML — keep it conservative: only rewrite what's
 * unambiguous, never anything that could change a well-formed value. Only the
 * `---\n…\n---` block is touched; body content is returned verbatim.
 *
 *  - strips a leading UTF-8 BOM (some editors prepend one, which pushes the
 *    opening `---` off column 0 so gray-matter sees no frontmatter at all)
 *  - converts leading TAB indentation to spaces (tabs are illegal YAML
 *    indentation but editors insert them on auto-indent)
 */
function normalizeFrontmatterSource(source: string): string {
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(src);
  if (!m) return src;
  const [whole, open, body, close] = m;
  // Only leading whitespace is rewritten, so tabs inside a quoted value survive.
  const fixedBody = body!.replace(/^[ \t]+/gm, (ws) => ws.replace(/\t/g, "  "));
  if (fixedBody === body) return src;
  return open! + fixedBody + close! + src.slice(whole!.length);
}

/**
 * Parse a page's YAML frontmatter (after normalization) with gray-matter.
 * This is the SINGLE source of truth for every frontmatter field, including
 * `role`, which gates access. Malformed YAML throws so the build fails loudly:
 * a page whose frontmatter can't be parsed must never silently fall back to a
 * permissive default. `path` only makes that error actionable. The result is
 * threaded through to renderMarkdown so the pipeline doesn't re-parse.
 */
function parsePageFrontmatter(source: string, path: string): PreParsedFrontmatter {
  const normalized = normalizeFrontmatterSource(source);
  if (!normalized.startsWith("---")) return { data: {}, content: normalized };
  try {
    const m = matter(normalized);
    const data = (m.data && typeof m.data === "object" ? m.data : {}) as Record<string, unknown>;
    return { data, content: m.content };
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(`${path}: malformed YAML frontmatter — ${detail}`);
  }
}

/** Coerce a frontmatter value (array, scalar, or missing) to a string list. */
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  return [];
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

/**
 * Strip an HTML body to plain text. Used to feed the search index from
 * the rendered article (post-wikilink, post-callout-redaction) so search
 * snippets read like prose, not markdown source. Tables, code blocks,
 * and inline HTML the user wrote all collapse to their text content;
 * common entities are decoded back to characters; numeric entities are
 * also handled. We replace tags with spaces (rather than empty string)
 * so adjacent block elements don't fuse their text together.
 */
function htmlToText(html: string, max: number): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
