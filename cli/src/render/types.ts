export interface PageMeta {
  /** Vault-relative path (e.g. "NPCs/Aldric.md"). */
  path: string;
  /** Display title. */
  title: string;
  /** Minimum role required to view this page. Default = first role in settings.roles. */
  role: string;
  /** Obsidian-style aliases; additional names that should resolve to this page. */
  aliases?: string[];
  /** Full parsed frontmatter; used by the Bases plugin for property queries. */
  frontmatter?: Record<string, unknown>;
  /** Unix-seconds; missing for synthesized folder indexes. */
  mtime?: number;
  birthtime?: number;
  /** Resolved cover image (served URL). Set during build by resolvePageImage. */
  coverImage?: string;
}

export interface ImageEntry {
  /** Vault-relative source path (e.g. "Attachments/portrait.png"). */
  sourcePath: string;
  /** Vault-relative output path after compression (e.g. "Attachments/portrait.webp"). */
  outputPath: string;
}

export type RenderWarningKind = "broken-link" | "missing-image" | "missing-page" | "missing-section";

export interface RenderWarning {
  kind: RenderWarningKind;
  target: string;
}

export interface RenderContext {
  /** slug → page metadata. Used to resolve [[wikilinks]]. */
  pages: Map<string, PageMeta>;
  /** slugified filename → image metadata. Used to resolve ![[image]] embeds. */
  images: Map<string, ImageEntry>;
  /** slug → raw markdown source. Used for ![[Page]] transclusion. */
  markdownContent: Map<string, string>;
  /** Slugified basename → raw YAML for standalone `.base` files. ![[Foo]] resolves a base if Foo.base exists. */
  bases: Map<string, string>;
  /** CSS width for images embedded without an explicit |N hint (e.g. "50vw"). Empty = no default. */
  defaultImageWidth: string;
  /** Set of role names that should be stripped from this render (callouts whose type matches a name in here are dropped). */
  redactRoles: ReadonlySet<string>;
  /** Internal: slugs of ancestor pages in the current embed chain (cycle detection). */
  embedAncestors?: ReadonlySet<string>;
  /** Internal: current embed depth. */
  embedDepth?: number;
}
