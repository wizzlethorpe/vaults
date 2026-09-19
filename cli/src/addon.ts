// The add-on contract: what an add-on contributes, and below it what core offers one. Published as `@wizzlethorpe/vaults/addon`.

import type { Migration } from "./migrate/types.js";
import type { TokenDownload } from "./render/auth-template.js";
import type { Handler } from "./render/handlers/types.js";
import type { PageMeta } from "./render/types.js";
import type { AnySettingDef, Settings } from "./settings.js";

export interface BuildInfo {
  vaultPath: string;
  /** Ordered low to high. */
  roles: string[];
  settings: Settings;
  /** Every page, whatever its role. Cover images are resolved by the time a variant is written. */
  pages: PageMeta[];
  /** Markdown source by page path. */
  sources: Map<string, string>;
  /** The stylesheet for page content, handlers' styles included. */
  contentCss: string;
  concurrency: number;
}

export interface VariantInfo {
  role: string;
  /** This role and every role below it. */
  visibleRoles: Set<string>;
  /** Holds each visible page as `<page>.html` and `<page>.body.html` (the article alone), and the variant's assets. */
  variantDir: string;
  /** Every image and passthrough file the variant ships, relative to `variantDir`. */
  assetPaths: string[];
}

export interface AddonBuild {
  writeVariant(variant: VariantInfo): Promise<void>;
  /** A file `writeVariant` writes that the Function serves with a bearer written in. */
  download?: TokenDownload;
}

export interface Addon {
  /** The add-on package's own version. Core refuses one that is not its own. */
  version: string;
  /** Built-in handlers, beside core's own. A vault's handler of the same name still replaces one. */
  handlers: Handler[];
  /** Run after core's, in this order. */
  migrations: Migration[];
  /** Written to the settings file after core's. */
  settingDefs: Record<string, AnySettingDef>;
  /**
   * Checks the schema's types cannot make, on values that already passed them. Corrects `values` in place.
   * A warning about a key must quote its full dotted path, as in 'block.key': that is how `vaults set` knows to refuse the value.
   */
  checkSettings(values: Record<string, unknown>, warnings: string[]): void;
  /** Runs once, before assets are staged, so it may name files to ship in a page's `extraAssets`. Returns nothing when the add-on writes nothing. */
  prepare(build: BuildInfo): Promise<AddonBuild | undefined>;
}

export { vaultRefs } from "./asset-refs.js";
export { htmlAttr, htmlEscape, htmlUnescape } from "./escape.js";
export { mergeDefaults } from "./frontmatter-defaults.js";
export { frontmatter, listMarkdownFiles, withFrontmatter } from "./migrate/files.js";
export type { Migration } from "./migrate/types.js";
export { SETTINGS_FILE, configPath, exists, settingsPath } from "./paths.js";
export type { TokenDownload } from "./render/auth-template.js";
export type { CodeBlockHandler, Handler, HandlerContext, InlineHandler } from "./render/handlers/types.js";
export { slugify } from "./render/slug.js";
export { PALETTE } from "./render/styles.js";
export type { PageMeta } from "./render/types.js";
export { PAGES_FILE_BYTES, describeType, loadSettings, writeSettings } from "./settings.js";
export type { AnySettingDef, Settings } from "./settings.js";
export { pMap } from "./util.js";
