// Compile per-pack JSON directories into LevelDB packs using the Foundry CLI,
// the same `fvtt package pack` path wands/data/scripts/compile-packs.ts uses.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
// Resolve the bundled Foundry CLI from our own dependencies (not the cwd), so
// the compiler works when installed globally and run from anywhere.
const require = createRequire(import.meta.url);
const FVTT_CLI = path.join(path.dirname(require.resolve("@foundryvtt/foundryvtt-cli/package.json")), "fvtt.mjs");
/**
 * Compile every <jsonDir>/<pack>/ directory into a LevelDB pack under
 * <outDir>/<pack>/. The Foundry CLI needs `--type Module --id <moduleId>` to
 * resolve the package context when explicit --in/--out are given. Returns the
 * list of compiled pack names.
 */
export function compilePacks(jsonDir, outDir, moduleId) {
    fs.mkdirSync(outDir, { recursive: true });
    const packs = fs
        .readdirSync(jsonDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    for (const pack of packs) {
        const inDir = path.join(jsonDir, pack);
        const packOut = path.join(outDir, pack);
        if (fs.existsSync(packOut))
            fs.rmSync(packOut, { recursive: true });
        execFileSync(process.execPath, [FVTT_CLI, "package", "pack", "-n", pack, "--type", "Module", "--id", moduleId, "--in", inDir, "--out", outDir], { stdio: "pipe" });
        const n = fs.readdirSync(inDir).filter((f) => f.endsWith(".json")).length;
        console.log(`  ${pack}: ${n} entries → LevelDB`);
    }
    return packs;
}
//# sourceMappingURL=packs.js.map