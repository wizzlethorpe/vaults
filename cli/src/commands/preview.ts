import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { watch } from "node:fs/promises";
import { buildSite } from "../build.js";
import { generateSessionSecret } from "../auth.js";
import { loadConfig, saveSessionSecret } from "../config.js";
import { runMigrations } from "../migrate/run.js";
import { defaultOutputDir } from "../paths.js";

interface PreviewOptions {
  output?: string;
  port?: number;
  imageQuality?: number;
  vaultName?: string;
  watch?: boolean;
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
  await runMigrations(vaultPath);
  const outputDir = opts.output ? resolve(opts.output) : defaultOutputDir(vaultPath);
  const port = opts.port ?? 4173;

  console.log(`Building site from ${vaultPath}...`);
  const buildOnce = async () => {
    const r = await buildSite({
      vaultPath,
      outputDir,
      vaultName: opts.vaultName ?? "Vault",
      imageQuality: opts.imageQuality ?? 85,
      maxFileBytes: DEFAULT_MAX_BYTES,
    });
    const summary = Object.entries(r.perRolePageCount)
      .map(([role, n]) => `${role}: ${n}`)
      .join(", ");
    console.log(`  ${summary} pages, ${r.imageCount} images, ${r.otherCount} other files`);
    return r;
  };
  const result = await buildOnce();

  // Multi-role builds need SESSION_SECRET so the auth middleware can sign
  // cookies. Reuse the secret in .vaultrc.json (the one prod also uses) so a
  // logged-in browser session survives across `vaults preview` ↔ `vaults push`.
  // When Patreon is configured, PATREON_CLIENT_SECRET also needs to be in
  // scope so the /auth/patreon/callback handler can exchange codes for
  // tokens — otherwise the visitor gets "Patreon login is misconfigured".
  // Wrangler resolves Functions/ relative to cwd, so we must run with the
  // output dir as cwd and pass "." rather than the absolute path.
  const wranglerArgs = ["wrangler", "pages", "dev", ".", `--port=${port}`, "--compatibility-date=2024-12-01"];
  if (result.roles.length > 1) {
    const cfg = await loadConfig(vaultPath, {});
    let secret = cfg.sessionSecret;
    if (!secret) {
      secret = generateSessionSecret();
      await saveSessionSecret(vaultPath, secret);
      console.log("Generated SESSION_SECRET (saved to config).");
    }
    wranglerArgs.push(`--binding=SESSION_SECRET=${secret}`);
    if (cfg.oauth?.patreon?.clientSecret) {
      wranglerArgs.push(`--binding=PATREON_CLIENT_SECRET=${cfg.oauth.patreon.clientSecret}`);
      console.log(`  Patreon login active; sign-in flows through localhost:${port}/auth/patreon/callback`);
    }
    console.log(`  multi-role build; sign in at http://localhost:${port}/login.html`);
  }

  // File watcher: re-run buildSite on source changes so the served output
  // stays fresh while wrangler is up. Wrangler picks up the new files
  // automatically; the browser still needs a manual refresh (full live-
  // reload would mean a separate WS layer + a client script in every page).
  // Disabled with --no-watch.
  if (opts.watch !== false) {
    void watchAndRebuild(vaultPath, outputDir, buildOnce);
    console.log(`  watching ${vaultPath} for changes (use --no-watch to disable)`);
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

/**
 * Watch the vault for source changes and re-run buildSite on each batch of
 * events. Debounced so a flurry of saves (Obsidian writes lock + temp + final)
 * collapses into one rebuild. Errors keep the watcher alive — a transient
 * broken markdown state shouldn't kill the dev loop.
 *
 * Skips events under .vaults/ (build cache, handler runtime files written
 * during build) and .git/ (commits churn many files). The output dir is
 * usually under .vaults/cache so it's already covered, but we also
 * skip-check explicitly in case the user pointed --output elsewhere.
 */
async function watchAndRebuild(
  vaultPath: string,
  outputDir: string,
  build: () => Promise<unknown>,
): Promise<void> {
  const ignoreSegments = [`${sep}.vaults${sep}`, `${sep}.git${sep}`];
  const outputUnder = outputDir.startsWith(vaultPath) ? outputDir.slice(vaultPath.length) : null;
  const shouldIgnore = (relPath: string): boolean => {
    const slashed = sep + relPath;
    if (ignoreSegments.some((s) => slashed.includes(s))) return true;
    if (outputUnder && slashed.startsWith(outputUnder)) return true;
    return false;
  };

  let pending = false;
  let inFlight = false;
  const trigger = async () => {
    if (inFlight) { pending = true; return; }
    inFlight = true;
    pending = false;
    try {
      console.log("\n  rebuilding…");
      await build();
    } catch (err) {
      console.warn(`  rebuild failed: ${(err as Error).message}`);
    } finally {
      inFlight = false;
      if (pending) setTimeout(trigger, DEBOUNCE_MS);
    }
  };

  let timer: NodeJS.Timeout | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void trigger(); }, DEBOUNCE_MS);
  };

  try {
    const watcher = watch(vaultPath, { recursive: true });
    for await (const event of watcher) {
      if (!event.filename) continue;
      if (shouldIgnore(event.filename)) continue;
      debounced();
    }
  } catch (err) {
    console.warn(`  watcher exited: ${(err as Error).message}`);
  }
}

const DEBOUNCE_MS = 250;
