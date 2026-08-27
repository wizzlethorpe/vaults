import { resolve } from "node:path";
import { buildFoundryModule } from "../foundry-module.js";
import { buildSite } from "../build.js";
import { defaultOutputDir, requireInitialisedVault } from "../paths.js";

interface BuildOptions {
  output?: string;
  allWarnings?: boolean;
  /** Compile the vault into an installable Foundry module first. */
  module?: boolean;
}

export async function build(vaultPath: string, opts: BuildOptions): Promise<void> {
  await requireInitialisedVault(vaultPath);
  const outputDir = opts.output ? resolve(opts.output) : defaultOutputDir(vaultPath);

  // Before the site build, which lists the vault's files once at the start:
  // the module writes a manifest and a zip *into* the vault, and a build that
  // had already listed the files would not see them.
  if (opts.module) {
    console.log("Compiling Foundry module...");
    const built = await buildFoundryModule({
      vaultPath,
      vaultId: vaultPath,
      outputDir: "downloads",
    });
    if (built) {
      console.log(
        `  ${built.moduleId} ${built.version}: ${built.documents} document(s)`
        + ` in ${built.packs.length} pack(s) -> ${built.zipPath}`,
      );
    }
  }

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
