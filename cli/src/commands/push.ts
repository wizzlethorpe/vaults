import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ApiClient } from "../api.js";
import { loadConfig } from "../config.js";
import { contentTypeFor } from "../images.js";
import { buildSite } from "../build.js";
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
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("npx", ["wrangler", "pages", "deploy", outputDir, `--project-name=${projectName}`], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`wrangler exited ${code}`))));
    proc.on("error", reject);
  });
}
