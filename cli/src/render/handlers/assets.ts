// Read and concatenate browser-side assets declared by handlers.
//
// Built-in handler assets are delivered as { source, content } pairs (so
// vaults-cli's own bundle ships the runtime without filesystem lookups).
// User handler assets are file paths relative to the handler's module file
// — those get read here, validated to live under the vault's
// .vaults/handlers/ tree (no `../../etc/passwd`), and included verbatim.
//
// Output is two strings: a concatenated _handlers.js and _handlers.css.
// Each unique source is included exactly once even if multiple handlers
// reference it, so shared utility files don't duplicate.

import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Handler } from "./types.js";
import type { LoadedHandler } from "./loader.js";

/**
 * Built-in handlers carry their asset content inline rather than loading
 * from disk. They register via this side-table so the bundler can include
 * them without filesystem reads.
 */
export interface BuiltinAsset {
  /** Stable identifier for dedup. Conventionally "<handler-name>.<kind>". */
  source: string;
  content: string;
}

export interface BuiltinAssetMap {
  scripts?: BuiltinAsset[];
  styles?: BuiltinAsset[];
}

/**
 * Built-in handlers attach their static assets to a side-table keyed on
 * the handler reference. The bundler looks them up here.
 */
const BUILTIN_ASSETS = new WeakMap<Handler, BuiltinAssetMap>();

export function registerBuiltinAssets(handler: Handler, assets: BuiltinAssetMap): void {
  BUILTIN_ASSETS.set(handler, assets);
}

export interface BundledAssets {
  js: string;
  css: string;
}

/**
 * Build the concatenated _handlers.js and _handlers.css for a deploy.
 *
 * @param userHandlers handlers loaded from `.vaults/handlers/`
 * @param builtinHandlers handlers shipped by vaults-cli core
 * @param vaultPath absolute path to the vault root, used for path-validation
 */
export async function bundleHandlerAssets(
  userHandlers: LoadedHandler[],
  builtinHandlers: Handler[],
  vaultPath: string,
): Promise<BundledAssets> {
  const seenJs = new Set<string>();
  const seenCss = new Set<string>();
  const jsParts: string[] = [];
  const cssParts: string[] = [];
  const handlersRoot = resolve(vaultPath, ".vaults/handlers");

  for (const h of builtinHandlers) {
    const inline = BUILTIN_ASSETS.get(h);
    if (!inline) continue;
    for (const a of inline.scripts ?? []) {
      if (seenJs.has(a.source)) continue;
      seenJs.add(a.source);
      jsParts.push(`/* ${a.source} */\n${a.content}`);
    }
    for (const a of inline.styles ?? []) {
      if (seenCss.has(a.source)) continue;
      seenCss.add(a.source);
      cssParts.push(`/* ${a.source} */\n${a.content}`);
    }
  }

  for (const { handler, sourcePath } of userHandlers) {
    const baseDir = dirname(sourcePath);
    for (const rel of handler.assets?.scripts ?? []) {
      const abs = resolveAssetPath(handlersRoot, baseDir, rel);
      if (seenJs.has(abs)) continue;
      seenJs.add(abs);
      jsParts.push(`/* ${rel} (${abs}) */\n${await readFile(abs, "utf8")}`);
    }
    for (const rel of handler.assets?.styles ?? []) {
      const abs = resolveAssetPath(handlersRoot, baseDir, rel);
      if (seenCss.has(abs)) continue;
      seenCss.add(abs);
      cssParts.push(`/* ${rel} (${abs}) */\n${await readFile(abs, "utf8")}`);
    }
  }

  return { js: jsParts.join("\n\n"), css: cssParts.join("\n\n") };
}

/**
 * Resolve a handler asset path and require it lives under .vaults/handlers/.
 * Throws on escape attempts so a typo or malicious manifest fails the build
 * instead of silently shipping nothing.
 */
function resolveAssetPath(handlersRoot: string, baseDir: string, rel: string): string {
  const abs = resolve(baseDir, rel);
  if (!isWithin(handlersRoot, abs)) {
    throw new Error(
      `handler asset path escapes .vaults/handlers/: ${rel} (resolved to ${abs}). ` +
      `Move the asset under .vaults/handlers/ and reference it relatively.`,
    );
  }
  return abs;
}

function isWithin(root: string, candidate: string): boolean {
  // resolve() normalises both, so a prefix check is sound. Append the
  // platform separator to avoid `/foo/bar-evil` matching `/foo/bar`.
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(rootWithSep);
}
