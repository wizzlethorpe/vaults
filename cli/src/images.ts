import { readFile } from "node:fs/promises";
import sharp from "sharp";

export const COMPRESSIBLE_EXT_RE = /\.(png|jpe?g|webp|gif|tiff?|avif)$/i;

export interface CompressedImage {
  body: Buffer;
  contentType: string;
  /** New path with .webp extension. */
  outputPath: string;
}

/**
 * Reads an image from disk, converts to webp at the given quality, and returns
 * the new buffer + path. Animated GIFs are preserved as animated webp.
 */
export async function compressImage(absolutePath: string, vaultRelPath: string, quality: number): Promise<CompressedImage> {
  const input = await readFile(absolutePath);
  const isAnimated = /\.gif$/i.test(absolutePath);
  const body = await sharp(input, { animated: isAnimated })
    .webp({ quality })
    .toBuffer();

  const outputPath = vaultRelPath.replace(COMPRESSIBLE_EXT_RE, ".webp");
  return { body, contentType: "image/webp", outputPath };
}

/**
 * Best-effort content-type lookup by extension. Falls back to octet-stream.
 */
export function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "text/markdown; charset=utf-8",
    markdown: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    json: "application/json",
    yaml: "application/yaml",
    yml: "application/yaml",
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    avif: "image/avif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}
