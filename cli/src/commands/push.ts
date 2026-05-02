import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, saveSessionSecret, type VaultConfig } from "../config.js";
import { buildSite } from "../build.js";
import { generateSessionSecret } from "../auth.js";

interface PushOptions {
  projectName?: string;
  imageQuality?: number;
  vaultName?: string;
  dryRun?: boolean;
  rotateSecret?: boolean;
}

export async function push(vaultPath: string, opts: PushOptions): Promise<void> {
  const cfg = await loadConfig(vaultPath, {
    ...(opts.projectName ? { projectName: opts.projectName } : {}),
    ...(opts.imageQuality != null ? { imageQuality: opts.imageQuality } : {}),
  });

  const vaultName = opts.vaultName ?? "Vault";
  const outputDir = join(vaultPath, ".vault-cache", "rendered");

  console.log(`Building site from ${vaultPath}...`);
  const result = await buildSite({
    vaultPath,
    outputDir,
    vaultName,
    imageQuality: cfg.imageQuality,
    maxFileBytes: cfg.maxFileBytes,
  });
  const summary = Object.entries(result.perRolePageCount)
    .map(([r, n]) => `${r}: ${n}`)
    .join(", ");
  console.log(`  ${summary} pages, ${result.imageCount} images, ${result.otherCount} other files`);

  if (opts.dryRun) {
    console.log(`Dry run complete. Rendered output is in ${outputDir}.`);
    return;
  }

  // First-push bootstrap: get a project name, ensure wrangler is authed,
  // and create the Pages project if it doesn't exist yet. Each step short-
  // circuits if it's already done, so subsequent pushes hit none of this.
  await ensureSetup(vaultPath, cfg);

  // Multi-role deployments need SESSION_SECRET on the Pages project so the
  // auth middleware can sign cookies. Reuse the secret in .vaultrc.json (the
  // one preview also uses) so a logged-in browser session survives across
  // preview ↔ push.
  //
  // --rotate-secret forces a fresh secret, which invalidates every issued
  // bearer token + cookie immediately (HMAC verification fails). Use it
  // when a token has leaked or you want to lock everyone out.
  if (result.roles.length > 1) {
    let secret = cfg.sessionSecret;
    if (opts.rotateSecret || !secret) {
      secret = generateSessionSecret();
      await saveSessionSecret(vaultPath, secret);
      console.log(opts.rotateSecret
        ? "Rotated SESSION_SECRET — all existing tokens are now invalid."
        : "Generated SESSION_SECRET (saved to .vaultrc.json).");
    }
    await wranglerSecret(cfg.projectName!, "SESSION_SECRET", secret);
  }
  await wranglerDeploy(outputDir, cfg.projectName!);
}

// ── First-push bootstrap ─────────────────────────────────────────────────

async function ensureSetup(vaultPath: string, cfg: VaultConfig): Promise<void> {
  // 1. Project name — derive a sensible default from the vault dir, but ask.
  if (!cfg.projectName) {
    const suggested = sanitizeProjectName(basename(vaultPath));
    const name = await promptIfTty(
      `Cloudflare Pages project name [${suggested}]: `,
      suggested,
      "No projectName in .vaultrc.json. Pass --project-name or run `vaults push` interactively.",
    );
    cfg.projectName = sanitizeProjectName(name);
    await saveConfig(vaultPath, cfg);
    console.log(`  saved projectName='${cfg.projectName}' to .vaultrc.json`);
  }

  // 2. Wrangler authentication — wrangler whoami exits non-zero if logged out.
  if (!await isWranglerLoggedIn()) {
    if (!stdin.isTTY) {
      throw new Error("Not authenticated with Cloudflare. Run `npx wrangler login` first.");
    }
    console.log("\nNot signed in to Cloudflare. Running `wrangler login`…");
    await runWranglerInteractive(["login"]);
  }

  // 3. Pages project — create it if missing. wrangler returns a clear error
  // if the project already exists; we treat that as success.
  if (!await pagesProjectExists(cfg.projectName)) {
    console.log(`Creating Pages project '${cfg.projectName}'…`);
    await runWranglerInteractive([
      "pages", "project", "create", cfg.projectName,
      "--production-branch=main",
    ]).catch((err) => {
      // If the failure is "already exists", that's fine — we lost the race
      // with another push or a user creating it manually.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already exists/i.test(msg)) throw err;
    });
  }
}

function sanitizeProjectName(name: string): string {
  // Cloudflare Pages: lowercase a–z, 0–9, hyphens; up to 58 chars.
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
  return cleaned || "vault";
}

async function isWranglerLoggedIn(): Promise<boolean> {
  try {
    await runWranglerCaptured(["whoami"]);
    return true;
  } catch {
    return false;
  }
}

async function pagesProjectExists(name: string): Promise<boolean> {
  try {
    const out = await runWranglerCaptured(["pages", "project", "list"]);
    // wrangler prints a table — check for the project name as a whole word.
    const re = new RegExp(`(^|\\s|\\|)${escapeRe(name)}(\\s|\\||$)`, "m");
    return re.test(out);
  } catch {
    // If we can't even list, assume not — `create` will give a clearer error.
    return false;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function promptIfTty(question: string, fallback: string, nonTtyError: string): Promise<string> {
  if (!stdin.isTTY) {
    if (fallback) {
      console.log(question + fallback + " (non-interactive)");
      return fallback;
    }
    throw new Error(nonTtyError);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

// ── Wrangler subprocess helpers ──────────────────────────────────────────

async function wranglerDeploy(outputDir: string, projectName: string): Promise<void> {
  console.log(`Deploying to Cloudflare Pages project '${projectName}'…`);
  // wrangler resolves functions/ relative to cwd, not the deploy path arg —
  // run it from outputDir so the generated middleware ships with the deploy.
  // Force --branch=main so the deploy is tagged Production (matches the
  // --production-branch=main we set during project create); without it
  // wrangler reads the vault's current git branch and tags as Preview, which
  // means the custom domain still serves the previous Production deploy.
  await runWranglerInteractive(
    ["pages", "deploy", ".", `--project-name=${projectName}`, "--branch=main", "--commit-dirty=true"],
    outputDir,
  );
}

async function wranglerSecret(projectName: string, name: string, value: string): Promise<void> {
  console.log(`Setting wrangler secret ${name}…`);
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "npx",
      ["wrangler", "pages", "secret", "put", name, `--project-name=${projectName}`],
      { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" },
    );
    proc.stdin.write(value + "\n");
    proc.stdin.end();
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`wrangler secret put exited ${code}`))));
    proc.on("error", reject);
  });
}

function runWranglerInteractive(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["wrangler", ...args], {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...(cwd ? { cwd } : {}),
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`wrangler ${args[0]} exited ${code}`))));
    proc.on("error", reject);
  });
}

function runWranglerCaptured(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["wrangler", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdoutBuf = "";
    let stderrBuf = "";
    proc.stdout.on("data", (d) => { stdoutBuf += d.toString(); });
    proc.stderr.on("data", (d) => { stderrBuf += d.toString(); });
    proc.on("exit", (code) => {
      if (code === 0) resolve(stdoutBuf);
      else reject(new Error(`wrangler ${args[0]} exited ${code}: ${stderrBuf || stdoutBuf}`));
    });
    proc.on("error", reject);
  });
}
