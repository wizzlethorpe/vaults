// Build helper: bundle the Foundry-side importer scripts into a single
// ESM file plus a sidecar version manifest. The bundle is served by
// every deploy at `_foundry/importer.js` and `_foundry/version.json`.
//
// The Foundry module fetches the bundle, hash-checks against its
// trust cache, evaluates it, and calls runSync / runRemove against a
// host it constructs. The version manifest carries `{ version, sha256 }`
// so the host can detect skew before evaluating.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_VERSION } from "./version.js";

const ENTRY_RELATIVE_TO_REPO = "foundry/scripts/importer-entry.mjs";

interface BuildResult {
  /** Bundled ESM source as a UTF-8 string. */
  source: string;
  /** SHA-256 of `source`, hex-encoded. */
  sha256: string;
}

/** Locate the Foundry-side entry point. The CLI is published from `cli/`
 *  but runs against the monorepo checkout during dev / `vaults build` —
 *  walk up from this file until we find the foundry/ sibling. */
function resolveEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: cli/src/ → cli → vaults/ → vaults/foundry/scripts/importer-entry.mjs
  // installed: dist/ → cli → vaults/ → vaults/foundry/scripts/importer-entry.mjs (same)
  return resolve(here, "..", "..", ENTRY_RELATIVE_TO_REPO);
}

async function bundleImporter(): Promise<BuildResult> {
  const entry = resolveEntry();
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    // Foundry globals are present at runtime; esbuild treats them as
    // externals automatically because they're not imported. No need to
    // mark anything as external explicitly.
    minify: false,
    sourcemap: false,
    legalComments: "none",
  });
  if (result.outputFiles.length !== 1) {
    throw new Error(`expected 1 bundle output, got ${result.outputFiles.length}`);
  }
  const source = result.outputFiles[0]!.text;
  const sha256 = createHash("sha256").update(source).digest("hex");
  return { source, sha256 };
}

/**
 * Write `_foundry/importer.js` + `_foundry/version.json` into the deploy.
 * Called from build.ts after the variant outputs are in place — the
 * bundle is a shared root-level asset (not per-variant), since it has
 * no role-gated content.
 */
export async function writeFoundryImporter(outputDir: string): Promise<void> {
  const { source, sha256 } = await bundleImporter();
  const dir = join(outputDir, "_foundry");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "importer.js"), source);
  await writeFile(
    join(dir, "version.json"),
    JSON.stringify({ version: CLI_VERSION, sha256 }, null, 2),
  );
}
