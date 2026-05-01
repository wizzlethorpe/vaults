import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ApiClient } from "../api.js";
import { loadConfig, saveSessionSecret } from "../config.js";
import { contentTypeFor } from "../images.js";
import { buildSite } from "../build.js";
import { generateSessionSecret } from "../auth.js";
import type { ScannedFile } from "../scan.js";

interface PushOptions {
  url?: string;
  key?: string;
  projectName?: string;
  imageQuality?: number;
  vaultName?: string;
  dryRun?: boolean;
}

export async function push(vaultPath: string, opts: PushOptions): Promise<void> {
  const cfg = await loadConfig(vaultPath, {
    ...(opts.url ? { url: opts.url } : {}),
    ...(opts.key ? { apiKey: opts.key } : {}),
    ...(opts.projectName ? { projectName: opts.projectName } : {}),
    ...(opts.imageQuality != null ? { imageQuality: opts.imageQuality } : {}),
  });

  const api = new ApiClient(cfg);
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

  await syncSource(api, result.withinLimit, opts.dryRun ?? false);

  if (opts.dryRun) {
    console.log(`Dry run complete. Rendered output is in ${outputDir}.`);
    return;
  }

  if (cfg.projectName) {
    // For multi-role deployments, ensure SESSION_SECRET is set on the Pages
    // project before deploying so the auth middleware can sign cookies.
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
  } else {
    console.log(`Rendered to ${outputDir}. Set 'projectName' in config to auto-deploy.`);
  }
}

async function syncSource(api: ApiClient, files: ScannedFile[], dryRun: boolean): Promise<void> {
  console.log("Fetching server manifest...");
  const manifest = await api.getManifest();
  const remote = new Map(manifest.map((m) => [m.path, m]));

  const toUpload: ScannedFile[] = [];
  for (const f of files) {
    const r = remote.get(f.path);
    if (!r || r.etag.replace(/^"|"$/g, "") !== f.hash) toUpload.push(f);
  }
  const localPaths = new Set(files.map((f) => f.path));
  const toDelete = manifest.map((m) => m.path).filter((p) => !localPaths.has(p));

  console.log(`  ${toUpload.length} to upload, ${toDelete.length} to delete, ${files.length - toUpload.length} unchanged`);
  if (dryRun) return;

  for (const f of toUpload) {
    const body = await readFile(f.absolute);
    await api.putSource(f.path, body, contentTypeFor(f.path));
    process.stdout.write(`  ↑ ${f.path}\n`);
  }
  for (const path of toDelete) {
    await api.deleteSource(path);
    process.stdout.write(`  − ${path}\n`);
  }
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
