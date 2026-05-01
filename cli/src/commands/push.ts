import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, saveSessionSecret } from "../config.js";
import { buildSite } from "../build.js";
import { generateSessionSecret } from "../auth.js";

interface PushOptions {
  projectName?: string;
  imageQuality?: number;
  vaultName?: string;
  dryRun?: boolean;
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

  if (!cfg.projectName) {
    console.log(`Rendered to ${outputDir}. Set 'projectName' in .vaultrc.json to auto-deploy.`);
    return;
  }

  // Multi-role deployments need SESSION_SECRET on the Pages project so the
  // auth middleware can sign cookies. Generate on first push, persist
  // locally in .vaultrc.json, and upload as a wrangler secret.
  const isMultiRole = result.roles.length > 1;
  if (isMultiRole) {
    let secret = cfg.sessionSecret;
    if (!secret) {
      secret = generateSessionSecret();
      await saveSessionSecret(vaultPath, secret);
      console.log("Generated SESSION_SECRET (saved to .vaultrc.json).");
    }
    await wranglerSecret(cfg.projectName, "SESSION_SECRET", secret);
  }
  await wranglerDeploy(outputDir, cfg.projectName);
}

async function wranglerDeploy(outputDir: string, projectName: string): Promise<void> {
  console.log(`Deploying to Cloudflare Pages project '${projectName}'...`);
  await runWrangler(["pages", "deploy", outputDir, `--project-name=${projectName}`]);
}

async function wranglerSecret(projectName: string, name: string, value: string): Promise<void> {
  console.log(`Setting wrangler secret ${name}...`);
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

function runWrangler(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["wrangler", ...args], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`wrangler exited ${code}`))));
    proc.on("error", reject);
  });
}
