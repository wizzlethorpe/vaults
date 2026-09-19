// What an add-on contributes to a build.

import type { TokenDownload } from "./render/auth-template.js";
import type { PageMeta } from "./render/types.js";
import type { Settings } from "./settings.js";

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
  /** Runs once, before assets are staged, so it may name files to ship in a page's `extraAssets`. Returns nothing when the add-on writes nothing. */
  prepare(build: BuildInfo): Promise<AddonBuild | undefined>;
}
