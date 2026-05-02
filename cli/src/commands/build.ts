import { join, resolve } from "node:path";
import { buildSite } from "../build.js";

interface BuildOptions {
  output?: string;
  imageQuality?: number;
  vaultName?: string;
  maxFileBytes?: number;
  allWarnings?: boolean;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export async function build(vaultPath: string, opts: BuildOptions): Promise<void> {
  const outputDir = opts.output
    ? resolve(opts.output)
    : join(vaultPath, ".vault-cache", "rendered");

  console.log(`Building site from ${vaultPath}...`);
  const result = await buildSite({
    vaultPath,
    outputDir,
    vaultName: opts.vaultName ?? "Vault",
    imageQuality: opts.imageQuality ?? 85,
    maxFileBytes: opts.maxFileBytes ?? DEFAULT_MAX_BYTES,
    allWarnings: opts.allWarnings,
  });
  const summary = Object.entries(result.perRolePageCount)
    .map(([role, n]) => `${role}: ${n}`)
    .join(", ");
  console.log(`  ${summary} pages, ${result.imageCount} images, ${result.otherCount} other files`);
  console.log(`Output: ${outputDir}`);
}
