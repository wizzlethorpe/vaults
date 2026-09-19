// What an add-on contributes to a build.

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
  /** Built-in handlers, beside core's own. A vault's handler of the same name still replaces one. */
  handlers: Handler[];
  /** Run after core's, in this order. */
  migrations: Migration[];
  /** Written to the settings file after core's. */
  settingDefs: Record<string, AnySettingDef>;
  /**
   * Checks the schema's types cannot make, on values that already passed them. Corrects `values` in place.
   * A warning about a key must quote its full dotted path, as in 'foundry.system': that is how `vaults set` knows to refuse the value.
   */
  checkSettings(values: Record<string, unknown>, warnings: string[]): void;
  /** Runs once, before assets are staged, so it may name files to ship in a page's `extraAssets`. Returns nothing when the add-on writes nothing. */
  prepare(build: BuildInfo): Promise<AddonBuild | undefined>;
}
