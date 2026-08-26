// Build helper: the Foundry-side importer is pre-bundled at CLI build time
// (see scripts/bundle-importer.mjs) into `dist/foundry-importer.bundle.js`,
// which ships inside the npm package. At deploy time we copy that bundle to
// `_foundry/importer.js`, which the Foundry host fetches and evaluates.
//
// Bundling ahead of publish (not here) means the installed CLI never runs
// esbuild on the user's machine and doesn't need the foundry/ source tree,
// which isn't part of the npm package.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/bundle-importer.mjs always emits the bundle into dist/. This module
// runs from dist/ once published, but from src/ under tsx (tests) — resolve to
// dist/ either way.
const here = dirname(fileURLToPath(import.meta.url));
const distDir = basename(here) === "src" ? join(here, "..", "dist") : here;
const BUNDLE_PATH = join(distDir, "foundry-importer.bundle.js");

/**
 * Write `_foundry/importer.js` into the deploy.
 * Called from build.ts after the variant outputs are in place — the
 * bundle is a shared root-level asset (not per-variant), since it has
 * no role-gated content.
 */
export async function writeFoundryImporter(outputDir: string): Promise<void> {
  const source = await readFile(BUNDLE_PATH, "utf8");
  const dir = join(outputDir, "_foundry");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "importer.js"), source);
}
