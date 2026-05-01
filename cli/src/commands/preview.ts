import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import { buildSite } from "../build.js";
import { contentTypeFor } from "../images.js";

interface PreviewOptions {
  output?: string;
  port?: number;
  imageQuality?: number;
  vaultName?: string;
  maxFileBytes?: number;
  role?: string;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

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

  // Pick which variant to serve.
  let role = opts.role;
  if (role && !result.roles.includes(role)) {
    console.error(`Role "${role}" is not in settings.roles (${result.roles.join(", ")})`);
    process.exit(1);
  }
  if (!role) role = result.roles[result.roles.length - 1]!;
  const variantDir = result.roles.length === 1
    ? outputDir
    : join(outputDir, "_variants", role);
  console.log(`  serving variant '${role}' from ${variantDir}`);

  await serve(outputDir, variantDir, port);
}

async function serve(rootDir: string, variantDir: string, port: number): Promise<void> {
  const server = createServer(async (req, res) => {
    try {
      const filePath = await resolveFile(rootDir, variantDir, req.url ?? "/");
      if (!filePath) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": contentTypeFor(filePath),
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server error");
    }
  });

  await new Promise<void>((resolve) => server.listen(port, () => resolve()));
  console.log(`\n  Preview ready at http://localhost:${port}\n  Press Ctrl-C to stop.\n`);
  await new Promise<void>(() => {});
}

/**
 * Look up `urlPath` in the variant first (HTML pages, search index, previews),
 * then fall back to the shared root (images, styles, attachments, other files).
 */
async function resolveFile(rootDir: string, variantDir: string, urlPath: string): Promise<string | null> {
  const cleaned = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
  const normalized = normalize(cleaned).replace(/^[/\\]+/, "");
  if (normalized.split(/[/\\]/).some((s) => s === "..")) return null;

  const dirs = variantDir === rootDir ? [rootDir] : [variantDir, rootDir];
  for (const dir of dirs) {
    for (const candidate of [
      join(dir, normalized),
      join(dir, normalized + ".html"),
      join(dir, normalized, "index.html"),
    ]) {
      try {
        const info = await stat(candidate);
        if (info.isFile()) return candidate;
      } catch { /* try next */ }
    }
  }
  return null;
}
