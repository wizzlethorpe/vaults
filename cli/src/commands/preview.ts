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
  console.log(`  ${result.pageCount} pages, ${result.imageCount} images, ${result.otherCount} other files`);

  await serve(outputDir, port);
}

async function serve(rootDir: string, port: number): Promise<void> {
  const server = createServer(async (req, res) => {
    try {
      const filePath = await resolveFile(rootDir, req.url ?? "/");
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
  await new Promise<void>(() => {}); // run until killed
}

async function resolveFile(rootDir: string, urlPath: string): Promise<string | null> {
  const cleaned = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
  // Reject path traversal
  const normalized = normalize(cleaned).replace(/^[/\\]+/, "");
  if (normalized.split(/[/\\]/).some((s) => s === "..")) return null;

  const candidates = [
    join(rootDir, normalized),
    join(rootDir, normalized + ".html"),
    join(rootDir, normalized, "index.html"),
  ];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch { /* try next */ }
  }
  return null;
}
