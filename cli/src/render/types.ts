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
  /** Vault-relative paths referenced via `@vault/...` inside this page's
   *  foundry.data_json file. Scene backgrounds/sounds/tiles live in that JSON
   *  content (not the page frontmatter), so the per-variant asset scanners
   *  consult this list to stage them. Populated during build. */
  foundryAssets?: string[];
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
  /** slugified filename → passthrough metadata. Used to resolve ![[file.ogg]]
   *  / ![[clip.mp4]] / ![[doc.pdf]] embeds for non-image media. Same shape
   *  as `images` (the passthrough pipeline staged its files via the same
   *  ImageEntry record). */
  passthroughs?: Map<string, ImageEntry>;
  /** slug → raw markdown source. Used for ![[Page]] transclusion. */
  markdownContent: Map<string, string>;
  /** Slugified basename → raw YAML for standalone `.base` files. ![[Foo]] resolves a base if Foo.base exists. */
  bases: Map<string, string>;
  /** CSS width for images embedded without an explicit |N hint (e.g. "300px"). Empty = no default. */
  defaultImageWidth: string;
  /** Set of role names that should be stripped from this render (callouts whose type matches a name in here are dropped). */
  redactRoles: ReadonlySet<string>;
  /** Built-in + user-defined inline / code-block handlers. Optional; absent = no custom handlers run. */
  handlers?: import("./handlers/types.js").HandlerRegistry;
  /**
   * Vault-relative source path → set of vault-relative paths it links to.
   * Pre-computed at build time from a wikilink scan over each page's source.
   * Used by Bases `file.hasLink("Target")` to evaluate without ordering
   * dependencies between page renders.
   */
  outlinksByPath?: Map<string, Set<string>>;
}
