import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { buildSite } from "../build.js";
import { generateSessionSecret } from "../auth.js";
import { loadConfig, saveSessionSecret } from "../config.js";

interface PreviewOptions {
  output?: string;
  port?: number;
  imageQuality?: number;
  vaultName?: string;
  maxFileBytes?: number;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Builds the site, then runs `wrangler pages dev` against the output. Wrangler
 * spawns a local Workers runtime; functions (auth middleware, MCP) execute
 * exactly as they would on Cloudflare, so the preview is a faithful mirror of
 * production. To switch roles, click "Sign in" in the sidebar; preview honours
 * the same cookies that production does.
 */
export async function preview(vaultPath: string, opts: PreviewOptions): Promise<void> {
  const outputDir = opts.output
    ? resolve(opts.output)
    : join(vaultPath, ".vault-cache", "rendered");
  const port = opts.port ?? 4173;

  console.log(`Building site from ${vaultPath}...`);
  const result = await buildSite({
    vaultPath,
    outputDir,
    vaultName: opts.vaultName ?? "Vault",
    imageQuality: opts.imageQuality ?? 85,
    maxFileBytes: opts.maxFileBytes ?? DEFAULT_MAX_BYTES,
  });
  const summary = Object.entries(result.perRolePageCount)
    .map(([role, n]) => `${role}: ${n}`)
    .join(", ");
  console.log(`  ${summary} pages, ${result.imageCount} images, ${result.otherCount} other files`);

  // Multi-role builds need SESSION_SECRET so the auth middleware can sign
  // cookies. Reuse the secret in .vaultrc.json (the one prod also uses) so a
  // logged-in browser session survives across `vaults preview` ↔ `vaults push`.
  // Wrangler resolves Functions/ relative to cwd, so we must run with the
  // output dir as cwd and pass "." rather than the absolute path.
  const wranglerArgs = ["wrangler", "pages", "dev", ".", `--port=${port}`, "--compatibility-date=2024-12-01"];
  if (result.roles.length > 1) {
    const cfg = await loadConfig(vaultPath, {});
    let secret = cfg.sessionSecret;
    if (!secret) {
      secret = generateSessionSecret();
      await saveSessionSecret(vaultPath, secret);
      console.log("Generated SESSION_SECRET (saved to .vaultrc.json).");
    }
    wranglerArgs.push(`--binding=SESSION_SECRET=${secret}`);
    console.log(`  multi-role build; sign in at http://localhost:${port}/login.html`);
  }

  console.log(`\n  Starting wrangler pages dev on port ${port}...`);
  console.log(`  Press Ctrl-C to stop.\n`);
  await new Promise<void>((resolveProc, reject) => {
    const proc = spawn("npx", wranglerArgs, {
      cwd: outputDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("exit", (code) => (code === 0 ? resolveProc() : reject(new Error(`wrangler exited ${code}`))));
    proc.on("error", reject);
  });
}
