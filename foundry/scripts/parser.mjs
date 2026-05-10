// Shared regexes used across the foundry module. Kept as a module so
// they live in one place and the same set is in scope wherever a path
// or URL is being inspected.

export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|tiff?|bmp|heic|apng)$/i;
// Non-image media (audio, video, PDFs, JSON) that ride alongside the wiki
// as passthroughs. Mirrors PASSTHROUGH_EXT_RE in the CLI; both regexes have
// to stay in sync. Used so the Foundry module pulls these into the same
// per-vault cache as images, letting Scenes / Playlists reference vault-
// local URLs instead of remote deploy URLs.
export const PASSTHROUGH_EXT_RE = /\.(ogg|mp3|m4a|wav|flac|opus|aac|mp4|webm|mov|ogv|pdf|epub|json)$/i;
// Anything we cache locally (images + passthroughs). One regex so the
// download / rewrite paths can treat both classes uniformly.
export const CACHED_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|tiff?|bmp|heic|apng|ogg|mp3|m4a|wav|flac|opus|aac|mp4|webm|mov|ogv|pdf|epub|json)$/i;
