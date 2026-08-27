import { resolve } from "node:path";
import { buildFoundryModule } from "../foundry-module.js";
import { loadSettings } from "../settings.js";
import { loadConfig } from "../config.js";
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

  // --module renders twice, and the reason is a genuine circle rather than
  // laziness. The module's journals must carry the *wiki's* rendered HTML —
  // handlers, `fm:` values and all — so the module cannot be built before the
  // render. But it writes a manifest and a zip into the vault, and the build
  // lists the vault's files once at the start, so anything appearing later is
  // invisible to the build that should ship it. Render, compile, render again.
  if (opts.module) {
    console.log(`Rendering ${vaultPath} (pass 1 of 2, for the module's journals)...`);
    await buildSite({ vaultPath, outputDir, allWarnings: false });

    console.log("Compiling Foundry module...");
    const built = await buildFoundryModule({
      vaultPath,
      outputDir: "downloads",
      renderedDir: outputDir,
      renderedRole: await lowestRole(vaultPath),
      foundryPackage: (await loadSettings(vaultPath)).values.foundry_package,
    });
    if (built) {
      // An in-place build (the author's module.json already names a download
      // URL, as WANDS's GitHub release does) writes the packs into the vault
      // and produces no zip, so point at the manifest instead of an empty path.
      console.log(
        `  ${built.moduleId} ${built.version}: ${built.documents} document(s)`
        + ` in ${built.packs.length} pack(s) -> ${built.zipPath || built.manifestPath}`,
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

/** The variant the module reads its journal HTML from: the vault's lowest role. */
async function lowestRole(vaultPath: string): Promise<string | undefined> {
  const cfg = await loadConfig(vaultPath, {});
  return cfg.roles.length > 1 ? cfg.roles[0] : undefined;
}
