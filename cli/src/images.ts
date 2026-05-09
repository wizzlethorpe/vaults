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
