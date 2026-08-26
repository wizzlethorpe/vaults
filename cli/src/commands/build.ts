import { resolve } from "node:path";
import { buildSite } from "../build.js";
import { defaultOutputDir, requireInitialisedVault } from "../paths.js";

interface BuildOptions {
  output?: string;
  allWarnings?: boolean;
}

export async function build(vaultPath: string, opts: BuildOptions): Promise<void> {
  await requireInitialisedVault(vaultPath);
  const outputDir = opts.output ? resolve(opts.output) : defaultOutputDir(vaultPath);

  console.log(`Building site from ${vaultPath}...`);
  const result = await buildSite({
    vaultPath,
    outputDir,
    allWarnings: opts.allWarnings,
  });
  const summary = Object.entries(result.perRolePageCount)
    .map(([role, n]) => `${role}: ${n}`)
    .join(", ");
  console.log(`  ${summary} pages, ${result.imageCount} images, ${result.otherCount} other files`);
  console.log(`Output: ${outputDir}`);
}
