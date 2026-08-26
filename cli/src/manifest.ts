// The deploy manifest: the wire format every client diffs against.
//
// Three consumers read this — the Foundry module's incremental sync, the
// Foundry importer bundle, and anything else pointed at a deployed vault — so
// its shape is a contract, not an implementation detail. Extracted from
// build.ts for that reason: it is the one part of the build whose output
// other software depends on byte for byte.

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { contentTypeForExt } from "./render/extensions.js";
import { CLI_VERSION, MANIFEST_VERSION, ID_SCHEME } from "./version.js";

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
   * Foundry-instantiation block. `foundry.base` names a template
   * (compendium UUID or `Type[:subtype]`); `foundry.data` is the
   * deep-merge overlay applied to the resulting doc; `foundry.sync`
   * (default true) controls whether the page reaches Foundry at all;
   * `foundry.journal` (default true) controls whether it also gets a
   * JournalEntryPage, as opposed to only the derived doc;
   * `foundry.embed` (default true) controls whether the page's article
   * auto-embeds into the doc's description field; `foundry.id` (16 chars [A-Za-z0-9])
   * pins both the JournalEntryPage id and the instantiated doc id to
   * an explicit value instead of the SHA1-derived default. Forwarded
   * verbatim to clients — the CLI validates shape but doesn't interpret
   * the values themselves.
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
export interface AssetAdvertisement {
  hasHandlerJs: boolean;
  hasHandlerCss: boolean;
  hasFoundryJs: boolean;
  hasFoundryCss: boolean;
}

export interface Manifest {
  /** Schema/protocol version. Increment on breaking shape changes; clients
   *  ignore unknown additive fields. Currently 1. */
  manifest_version: typeof MANIFEST_VERSION;
  /** CLI version that built this deploy. Clients can warn on major skew. */
  cli_version: string;
  /** Document-id derivation scheme; advertised so a future change can be
   *  detected by clients holding entries derived under the prior scheme. */
  id_scheme: typeof ID_SCHEME;
  name: string;
  auth: { required: boolean; roles: string[] };
  /** Paths to handler asset bundles, when emitted. Clients fetch these
   *  instead of guessing well-known paths so future renames don't break. */
  assets?: {
    browser?: { js?: string; css?: string };
    foundry?: { js?: string; css?: string };
  };
  files: ManifestEntry[];
}

export async function buildManifest(
  rootDir: string,
  variantDir: string,
  bodyMeta: Map<string, BodyMeta>,
  authRequired: boolean,
  roles: string[],
  vaultName: string,
  assets: AssetAdvertisement,
): Promise<Manifest> {
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
  // Asset advertisement so clients (Foundry, MCP) fetch the right paths
  // instead of guessing well-known names — lets us move things later.
  const assetBlock: Manifest["assets"] = {};
  if (assets.hasHandlerJs || assets.hasHandlerCss) {
    assetBlock.browser = {
      ...(assets.hasHandlerJs ? { js: "/_handlers.js" } : {}),
      ...(assets.hasHandlerCss ? { css: "/_handlers.css" } : {}),
    };
  }
  if (assets.hasFoundryJs || assets.hasFoundryCss) {
    assetBlock.foundry = {
      ...(assets.hasFoundryJs ? { js: "/_handlers.foundry.js" } : {}),
      ...(assets.hasFoundryCss ? { css: "/_handlers.foundry.css" } : {}),
    };
  }
  return {
    manifest_version: MANIFEST_VERSION,
    cli_version: CLI_VERSION,
    id_scheme: ID_SCHEME,
    name: vaultName,
    auth: { required: authRequired, roles },
    ...(Object.keys(assetBlock).length > 0 ? { assets: assetBlock } : {}),
    files,
  };
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
    // Fold meta JSON into the hash so meta-only edits (e.g. a foundry.base
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
