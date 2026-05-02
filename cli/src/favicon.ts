import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import sharp from "sharp";

const ICON_SIZE = 32;

/**
 * Render the favicon for a vault to an ICO buffer. If the user pointed
 * `settings.favicon` at a real file, we resize that image; otherwise we
 * generate a default; a rounded square in the vault's accent colour with
 * a single uppercase letter centred on it.
 */
export async function buildFavicon(opts: {
  vaultPath: string;
  faviconPath: string;
  letter: string;
  accentColor: string;
}): Promise<Buffer> {
  const png = opts.faviconPath
    ? await renderUserImage(opts.vaultPath, opts.faviconPath)
    : await renderDefaultIcon(opts.letter, opts.accentColor);
  return wrapPngAsIco(png, ICON_SIZE);
}

async function renderUserImage(vaultPath: string, faviconPath: string): Promise<Buffer> {
  const abs = isAbsolute(faviconPath) ? faviconPath : join(vaultPath, faviconPath);
  const source = await readFile(abs);
  return sharp(source).resize(ICON_SIZE, ICON_SIZE, { fit: "cover" }).png().toBuffer();
}

async function renderDefaultIcon(letter: string, accent: string): Promise<Buffer> {
  const fg = bestForeground(accent);
  // Round-cornered square with a single letter centred. Embedded as an
  // SVG so sharp rasterises it cleanly at the target size.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="5" fill="${escAttr(accent)}"/>
  <text x="16" y="22" font-family="Iowan Old Style, Palatino Linotype, Georgia, serif"
        font-size="22" font-weight="700" text-anchor="middle"
        fill="${escAttr(fg)}">${escText(letter)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).resize(ICON_SIZE, ICON_SIZE).png().toBuffer();
}

/**
 * Wrap a PNG buffer in an ICO container. Modern browsers accept PNG-in-ICO
 * for any size; the dirent's width/height bytes are advisory.
 *
 * Layout:
 *   ICONDIR     (6 bytes)   reserved=0, type=1, count=1
 *   ICONDIRENTRY (16 bytes) width, height, ..., size, offset
 *   <PNG bytes>
 */
function wrapPngAsIco(png: Buffer, size: number): Buffer {
  const HEADER = 6 + 16;
  const buf = Buffer.alloc(HEADER + png.length);
  buf.writeUInt16LE(0, 0);                       // reserved
  buf.writeUInt16LE(1, 2);                       // type: icon
  buf.writeUInt16LE(1, 4);                       // image count
  buf.writeUInt8(size === 256 ? 0 : size, 6);    // width  (0 = 256)
  buf.writeUInt8(size === 256 ? 0 : size, 7);    // height
  buf.writeUInt8(0, 8);                          // palette
  buf.writeUInt8(0, 9);                          // reserved
  buf.writeUInt16LE(1, 10);                      // colour planes
  buf.writeUInt16LE(32, 12);                     // bits per pixel
  buf.writeUInt32LE(png.length, 14);             // bytes of image data
  buf.writeUInt32LE(HEADER, 18);                 // offset to image data
  png.copy(buf, HEADER);
  return buf;
}

/**
 * Pick black or white as the letter colour against `accent` so the icon
 * stays readable for whatever colour the user picked. Uses W3C relative
 * luminance.
 */
function bestForeground(accent: string): string {
  const rgb = parseColor(accent);
  if (!rgb) return "#ffffff";
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(rgb[0]!) + 0.7152 * lin(rgb[1]!) + 0.0722 * lin(rgb[2]!);
  return L > 0.5 ? "#1d1a17" : "#ffffff";
}

function parseColor(s: string): [number, number, number] | null {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!hex) return null;
  let h = hex[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
