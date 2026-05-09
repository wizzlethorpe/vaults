import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import sharp from "sharp";
import { htmlEscape, htmlAttr } from "./escape.js";

const ICON_SIZE = 32;

/**
 * Render the favicon for a vault to an ICO buffer. If the user pointed
 * `settings.favicon` at a real file, we resize that image; otherwise we
 * generate a default; a rounded square in the theme background colour with
 * a single uppercase letter centred in the vault accent colour.
 */
export async function buildFavicon(opts: {
  vaultPath: string;
  faviconPath: string;
  letter: string;
  backgroundColor: string;
  accentColor: string;
}): Promise<Buffer> {
  const png = opts.faviconPath
    ? await renderUserImage(opts.vaultPath, opts.faviconPath)
    : await renderDefaultIcon(opts.letter, opts.backgroundColor, opts.accentColor);
  // Modern browsers support PNG favicons; return directly.
  return png;
}

async function renderUserImage(vaultPath: string, faviconPath: string): Promise<Buffer> {
  const abs = isAbsolute(faviconPath) ? faviconPath : join(vaultPath, faviconPath);
  const source = await readFile(abs);
  return sharp(source).resize(ICON_SIZE, ICON_SIZE, { fit: "cover" }).png().toBuffer();
}

async function renderDefaultIcon(letter: string, bg: string, accent: string): Promise<Buffer> {
  // Round-cornered square with a single letter centred. Embedded as an
  // SVG so sharp rasterises it cleanly at the target size.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="5" fill="${htmlAttr(bg)}"/>
  <text x="16" y="22" font-family="Iowan Old Style, Palatino Linotype, Georgia, serif"
        font-size="22" font-weight="700" text-anchor="middle"
        fill="${htmlAttr(accent)}">${htmlEscape(letter)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).resize(ICON_SIZE, ICON_SIZE).png().toBuffer();
}
