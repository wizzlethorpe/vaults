// The Foundry half of a build: checks the vault's `foundry:` blocks, then writes each role's grafts.json and the asset zips it names.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Addon, AddonBuild, BuildInfo, VariantInfo } from "./addon.js";
import { vaultRefs } from "./asset-refs.js";
import {
  GRAFTS_DOWNLOAD, buildGrafts, linkIndex, observable, pagesFrom, secretRoles, withFolderIndexes,
  type AssetFile, type GraftOptions,
} from "./foundry-grafts.js";
import { toFoundryHtml } from "./foundry-html.js";
import { loadDataJson, warnFoundryDocCollisions } from "./foundry-meta.js";
import { TTRPG_SETTINGS, normalizeTtrpgSettings, type TtrpgSettings } from "./foundry-settings.js";
import { foundryPatchKeysMigration } from "./migrate/0.15-foundry-patch-keys.js";
import { foundryPinnedIdMigration } from "./migrate/0.15-foundry-pinned-id.js";
import { foundryEnabledMigration } from "./migrate/0.23-foundry-enabled.js";
import { battlemapHandler } from "./render/handlers/builtin/battlemap.js";
import { diceHandler } from "./render/handlers/builtin/dice.js";
import { foundryInstallHandler, hasFoundryInstall } from "./render/handlers/builtin/foundry-install.js";
import { fvttLinkHandler } from "./render/handlers/builtin/fvtt-link.js";
import { statblockHandler } from "./render/handlers/builtin/statblock.js";
import { PAGES_FILE_BYTES } from "./settings.js";
import { pMap } from "./util.js";
import { chunkAssets, zip } from "./zip.js";

/** What a loaded `patch_json` file gives its page: the patch when it is a plain object, and the vault files it names either way. */
export function readPatch(loaded: unknown): { patch?: Record<string, unknown>; assets: string[] } {
  const assets = vaultRefs(loaded);
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return { assets };
  return { patch: loaded as Record<string, unknown>, assets };
}

export const foundryAddon: Addon = {
  handlers: [diceHandler, statblockHandler, battlemapHandler, foundryInstallHandler, fvttLinkHandler],
  migrations: [foundryPatchKeysMigration, foundryPinnedIdMigration, foundryEnabledMigration],
  settingDefs: TTRPG_SETTINGS,
  checkSettings: normalizeTtrpgSettings,
  async prepare(build: BuildInfo): Promise<AddonBuild | undefined> {
    const { pages } = build;
    const settings = build.settings as TtrpgSettings;
    const enabled = settings.foundry.enabled;
    const siteUrl = settings.site_url;

    // The block offers a download this build is not writing, so its link would 404. Fail rather than deploy a dead one.
    const installPages = pages.filter((p) => hasFoundryInstall(build.sources.get(p.path) ?? "")).map((p) => p.path);
    if (installPages.length > 0 && !(enabled && siteUrl)) {
      const why = enabled ? "site_url is not set" : "foundry.enabled is false";
      throw new Error(
        `foundry-install block on ${installPages.length} page(s), but ${why},`
        + ` so this vault writes nothing to import:\n${installPages.map((p) => `  ${p}`).join("\n")}`,
      );
    }

    warnFoundryDocCollisions(pages);

    if (enabled && !settings.foundry.core_version
      && pages.some((p) => (p.frontmatter?.["foundry"] as { source?: unknown })?.source)) {
      console.warn(
        "  foundry.core_version is not set, so documents carry no _stats.coreVersion."
        + " Foundry rejects those and builds a degraded copy instead: a Scene loses its levels."
        + " Set it to the full Foundry version your exported JSON came from, e.g. 14.359.",
      );
    }

    // Every asset source is an absolute URL, so without one a build in Foundry arrives with none of its art.
    if (enabled && !siteUrl) {
      console.warn(
        "  site_url is not set, so the Foundry entry list names no media."
        + " Pages still build, but their images and audio do not."
        + " Set it to the URL this vault is served from, e.g. https://notes.example.com.",
      );
    }

    // Read once for every role: a Scene sidecar is the largest thing in the vault to parse.
    const patches = new Map<string, Record<string, unknown>>();
    await Promise.all(pages.map(async (p) => {
      const ref = (p.frontmatter?.["foundry"] as { patch_json?: unknown } | undefined)?.patch_json;
      if (typeof ref !== "string" || !ref.trim()) return;
      const { patch, assets } = readPatch(await loadDataJson(build.vaultPath, ref.trim(), p.path));
      // A Scene's backgrounds, sounds and tiles are named inside the file, where no page scanner looks.
      if (assets.length > 0) p.extraAssets = assets;
      if (patch) patches.set(p.path, patch);
    }));

    if (!enabled) return undefined;
    return { writeVariant: (variant) => writeGrafts(build, variant, patches), download: GRAFTS_DOWNLOAD };
  },
};

/** One role's entry list, inside its variant directory so the middleware gates it. */
async function writeGrafts(
  build: BuildInfo, variant: VariantInfo, patches: Map<string, Record<string, unknown>>,
): Promise<void> {
  const { roles } = build;
  const settings = build.settings as TtrpgSettings;
  const siteUrl = settings.site_url;
  const { variantDir } = variant;
  // Names the directory the reader's assets land in, so changing it strands the copies a reader already has.
  const vaultId = settings.vault_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vault";
  const assetBase = `vaults/${vaultId}`;
  // Every asset the entries end up naming, collected as they are written.
  const namedAssets = new Set<string>();
  const graftPages = withFolderIndexes(pagesFrom(build.pages, variant.visibleRoles, patches), roles);
  // Rendered only when an entry asks: a rendered body names its images for shipping, so one no entry carries must not be rendered.
  const articles = new Map(await pMap(graftPages.filter((p) => p.foundry?.sync !== false), build.concurrency,
    async (page) => [page.path, await readFile(join(variantDir, `${page.path.replace(/\.md$/i, "")}.body.html`), "utf8")] as const));
  const rendered = new Map<string, string>();
  const graftOpts: GraftOptions = {
    vaultId,
    roles,
    playerRole: settings.foundry.player_role,
    assetBase,
    namedAssets,
    coreVersion: settings.foundry.core_version,
    system: settings.foundry.system,
    // Once per page: a body can be both a journal page and a document's description.
    body: (page) => {
      let html = rendered.get(page.path);
      if (html === undefined) {
        html = toFoundryHtml(articles.get(page.path) ?? "", links, assetBase, namedAssets, {
          // The rule the entry's ownership uses: a page players never open needs no secrets.
          secretRoles: observable(page, graftOpts) ? hidden : new Set(),
          css: build.contentCss,
        });
        rendered.set(page.path, html);
      }
      return html;
    },
  };
  const links = linkIndex(graftPages, graftOpts);
  const hidden = secretRoles(graftOpts);
  const grafts = buildGrafts(graftPages, graftOpts);
  for (const warning of grafts.warnings) console.warn(`  warning: ${warning}`);
  // Only what the entries name: media that appears only on the wiki must not land in the reader's data directory.
  const wanted = variant.assetPaths.filter((p) => namedAssets.has(p));
  const graftsPath = join(variantDir, GRAFTS_DOWNLOAD.path);
  await mkdir(dirname(graftsPath), { recursive: true });
  const files = await assetFiles(wanted, variantDir, siteUrl, assetBase, settings.zip_assets);
  // The middleware fills in a token for each origin when a reader downloads the file.
  if (files.length > 0) grafts.file.assets = { http: { auth: { [new URL(siteUrl).origin]: "" }, files } };

  const json = JSON.stringify(grafts.file, null, 2);
  assertDeployable(`${variant.role}'s grafts.json`, Buffer.byteLength(json));
  await writeFile(graftsPath, json);
}

/**
 * The media this variant ships, as files for graft's `http` handler. The content hash in each URL is how graft tells a changed file from one it has.
 * No variant segment: the middleware serves a bare path from the caller's own variant.
 */
async function assetFiles(
  paths: string[], variantDir: string, siteUrl: string, assetBase: string, zipMiB: number,
): Promise<AssetFile[]> {
  if (!siteUrl) return [];
  const base = siteUrl.replace(/\/+$/, "");
  const url = (path: string) => path.split("/").map(encodeURIComponent).join("/");
  const md5 = (data: Buffer) => createHash("md5").update(data).digest("hex").slice(0, 16);

  // Read once here for the hash and size. A chunk reads its own members again when it is built, so only one chunk is ever in memory.
  const found: Array<{ path: string; size: number; hash: string }> = [];
  for (const path of [...paths].sort()) {
    const bytes = await readFile(join(variantDir, path));
    found.push({ path, size: bytes.length, hash: md5(bytes) });
  }

  const zipOf = new Map<string, string>();
  for (const chunk of zipMiB > 0 ? chunkAssets(found, zipMiB * 1024 * 1024) : []) {
    const archive = zip(await Promise.all(chunk.map(async (f) =>
      ({ name: f.path, data: await readFile(join(variantDir, f.path)) }))));
    // Named by content, so an unchanged chunk keeps its URL across pushes.
    const name = `_foundry/assets-${md5(archive)}.zip`;
    await writeFile(join(variantDir, name), archive);
    for (const f of chunk) zipOf.set(f.path, `${base}/${name}`);
  }

  return found.map((f) => {
    const own = `${base}/${url(f.path)}?v=${f.hash}`;
    const zipped = zipOf.get(f.path);
    return {
      source: zipped ? [`${zipped}#${url(f.path)}`, own] : own,
      destination: `${assetBase}/${f.path}`,
      size: f.size,
    };
  });
}

/** Throws when a file is larger than Cloudflare Pages deploys, naming the file and its size. */
export function assertDeployable(label: string, bytes: number): void {
  if (bytes > PAGES_FILE_BYTES) {
    throw new Error(`${label} is ${bytes} bytes, over the ${PAGES_FILE_BYTES} bytes Cloudflare Pages deploys as one file`);
  }
}
