export interface PageMeta {
  /** Vault-relative path (e.g. "NPCs/Aldric.md"). */
  path: string;
  /** Display title. */
  title: string;
  /** Unix-seconds; missing for synthesized folder indexes. */
  mtime?: number;
  birthtime?: number;
}

export interface ImageEntry {
  /** Vault-relative source path (e.g. "Attachments/portrait.png"). */
  sourcePath: string;
  /** Vault-relative output path after compression (e.g. "Attachments/portrait.webp"). */
  outputPath: string;
}

export interface RenderContext {
  /** slug → page metadata. Used to resolve [[wikilinks]]. */
  pages: Map<string, PageMeta>;
  /** slugified filename → image metadata. Used to resolve ![[image]] embeds. */
  images: Map<string, ImageEntry>;
  /** slug → raw markdown source. Used for ![[Page]] transclusion. */
  markdownContent: Map<string, string>;
  /** CSS width for images embedded without an explicit |N hint (e.g. "50vw"). Empty = no default. */
  defaultImageWidth: string;
  /** Internal: slugs of ancestor pages in the current embed chain (cycle detection). */
  embedAncestors?: ReadonlySet<string>;
  /** Internal: current embed depth. */
  embedDepth?: number;
}
