// Discover and load custom handlers from a vault's `.vaults/handlers/`
// directory. Each handler file is dynamically imported; it must export a
// `handler` (single Handler) or `handlers` (Handler[]) named export.
//
// Returns the absolute on-disk path each handler was loaded from. The path
// is the anchor for resolving asset paths declared on the handler (see
// HandlerAssets in types.ts).
//
// Trust model: handlers are loaded and executed verbatim. Anyone running
// `vaults push` is trusting the vault's contents. Same trust model as
// `npm install` for any project they choose to build.

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Handler } from "./types.js";

const HANDLER_DIR = ".vaults/handlers";
// Handler modules are `.mjs` (Node ESM). `.js` files in the same directory
// are treated as browser-side runtime assets and skipped by the loader —
// they get picked up via the `assets.scripts` declaration on a handler.
const SUPPORTED_EXTENSIONS = [".mjs"];

/**
 * A handler plus the absolute on-disk path of the module file it was loaded
 * from. The path anchors relative asset paths.
 */
export interface LoadedHandler {
  handler: Handler;
  sourcePath: string;
}

/**
 * Returns user-defined handlers discovered in `<vaultPath>/.vaults/handlers/`.
 * Returns an empty array if the directory doesn't exist; this is the common
 * case (most vaults won't ship handlers).
 *
 * Each handler module's named exports are inspected:
 *   - `handler` (single Handler) is registered as one handler.
 *   - `handlers` (Handler[]) is spread into the result.
 *
 * Modules that throw on import or that export neither name produce a
 * warning but do not abort the build.
 */
export async function loadUserHandlers(vaultPath: string): Promise<LoadedHandler[]> {
  const dir = join(vaultPath, HANDLER_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const results: LoadedHandler[] = [];
  for (const name of entries.sort()) {
    if (!SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
    const path = resolve(dir, name);
    let info;
    try {
      info = await stat(path);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;

    const url = pathToFileURL(path).href;
    let mod: Record<string, unknown>;
    try {
      mod = await import(url);
    } catch (err) {
      console.warn(`  handlers: failed to import ${name}: ${(err as Error).message}`);
      continue;
    }

    const single = mod.handler;
    const many = mod.handlers;
    if (Array.isArray(many)) {
      for (const h of many) {
        if (isHandlerLike(h)) results.push({ handler: h, sourcePath: path });
      }
    }
    if (isHandlerLike(single)) results.push({ handler: single, sourcePath: path });

    if (single == null && !Array.isArray(many)) {
      console.warn(`  handlers: ${name} exports neither 'handler' nor 'handlers'; skipped`);
    }
  }
  return results;
}

function isHandlerLike(v: unknown): v is Handler {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.render !== "function") return false;
  return typeof o.inline === "string" || typeof o.codeBlock === "string";
}
