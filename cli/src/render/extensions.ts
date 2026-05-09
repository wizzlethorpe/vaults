// File-extension constants + helpers shared across the build pipeline.
//
// Three independent vocabularies live here:
//
//   IMAGE_EXT_RE          — anything that can be referenced as ![[name.ext]].
//                           Superset of COMPRESSIBLE_EXT_RE; covers SVGs and
//                           similar formats that ship as-is rather than being
//                           recoded to webp.
//
//   COMPRESSIBLE_EXT_RE   — image formats that the build re-encodes to webp
//                           via sharp. Re-exported from images.ts so the
//                           historical import path keeps working.
//
//   PASSTHROUGH_EXT_RE    — non-image media that ride alongside the wiki
//                           (audio, video, PDF, epub). Shipped per-variant so
//                           e.g. DM-only audio doesn't leak to the public
//                           deploy. Anything outside this list is "unknown"
//                           and skipped unless include_unknown_files is on.
//
//   contentTypeForExt()   — best-effort MIME lookup keyed off the extension.
//                           Used by manifests so the deploy and Foundry sync
//                           agree on each file's content-type.

export { COMPRESSIBLE_EXT_RE } from "../images.js";

export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|tiff?|bmp|heic|apng)$/i;

export const PASSTHROUGH_EXT_RE = /\.(ogg|mp3|m4a|wav|flac|opus|aac|mp4|webm|mov|ogv|pdf|epub)$/i;

const CONTENT_TYPES: Record<string, string> = {
  // Text / markup
  html: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  // Audio / video
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  // Documents
  pdf: "application/pdf",
};

/** Best-effort content-type lookup by extension. Falls back to octet-stream. */
export function contentTypeForExt(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
